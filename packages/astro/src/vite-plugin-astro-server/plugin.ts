import { AsyncLocalStorage } from 'node:async_hooks';
import type fs from 'node:fs';
import { IncomingMessage } from 'node:http';
import type * as vite from 'vite';
import type { AstroSettings, ManifestData, SSRManifest } from '../@types/astro.js';
import type { SSRManifestI18n } from '../core/app/types.js';
import { createKey } from '../core/encryption.js';
import { getViteErrorPayload } from '../core/errors/dev/index.js';
import { AstroError, AstroErrorData } from '../core/errors/index.js';
import { patchOverlay } from '../core/errors/overlay.js';
import type { Logger } from '../core/logger/core.js';
import { createViteLoader } from '../core/module-loader/index.js';
import { injectDefaultRoutes } from '../core/routing/default.js';
import { createRouteManifest } from '../core/routing/index.js';
import { toFallbackType, toRoutingStrategy } from '../i18n/utils.js';
import { baseMiddleware } from './base.js';
import { createController } from './controller.js';
import { recordServerError } from './error.js';
import { DevPipeline } from './pipeline.js';
import { handleRequest } from './request.js';
import { setRouteError } from './server-state.js';

import { createServerModuleRunner } from 'vite';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
// import { writeFileSync } from 'node:fs';

export interface AstroPluginOptions {
	settings: AstroSettings;
	logger: Logger;
	fs: typeof fs;
}

const environmentContext = {} as { manifestData: ManifestData };

export default function createVitePluginAstroServer({
	settings,
	logger,
	fs: fsMod,
}: AstroPluginOptions): vite.Plugin {
	return {
		name: 'astro:server',
		async configureServer(viteServer) {
			const loader = createViteLoader(viteServer);
			const manifest = createDevelopmentManifest(settings);
			let manifestData: ManifestData = injectDefaultRoutes(
				manifest,
				createRouteManifest({ settings, fsMod }, logger),
			);
			environmentContext.manifestData = manifestData;
			const pipeline = DevPipeline.create(manifestData, { loader, logger, manifest, settings });
			const controller = createController({ loader });
			const localStorage = new AsyncLocalStorage();

			/** rebuild the route cache + manifest, as needed. */
			function rebuildManifest(needsManifestRebuild: boolean) {
				pipeline.clearRouteCache();
				if (needsManifestRebuild) {
					manifestData = injectDefaultRoutes(manifest, createRouteManifest({ settings }, logger));
					pipeline.setManifestData(manifestData);
				}
			}

			// Rebuild route manifest on file change, if needed.
			viteServer.watcher.on('add', rebuildManifest.bind(null, true));
			viteServer.watcher.on('unlink', rebuildManifest.bind(null, true));
			viteServer.watcher.on('change', rebuildManifest.bind(null, false));

			function handleUnhandledRejection(rejection: any) {
				const error = new AstroError({
					...AstroErrorData.UnhandledRejection,
					message: AstroErrorData.UnhandledRejection.message(rejection?.stack || rejection),
				});
				const store = localStorage.getStore();
				if (store instanceof IncomingMessage) {
					const request = store;
					setRouteError(controller.state, request.url!, error);
				}
				const { errorWithMetadata } = recordServerError(loader, settings.config, pipeline, error);
				setTimeout(
					async () => loader.webSocketSend(await getViteErrorPayload(errorWithMetadata)),
					200,
				);
			}

			process.on('unhandledRejection', handleUnhandledRejection);

			const __dirname = fileURLToPath(new URL('.', import.meta.url));

			const moduleRunner = createServerModuleRunner(viteServer.environments['__ssr_environment__']);
			const entrypoint = await moduleRunner.import(
				path.join(__dirname, 'entrypoints/node-entrypoint.js'),
			);
			const handler = entrypoint.default.fetch;

			return () => {
				// Push this middleware to the front of the stack so that it can intercept responses.
				// fix(#6067): always inject this to ensure zombie base handling is killed after restarts
				viteServer.middlewares.stack.unshift({
					route: '',
					handle: baseMiddleware(settings, logger),
				});
				// Note that this function has a name so other middleware can find it.
				viteServer.middlewares.use(async function astroDevHandler(request, response) {
					if (request.url === undefined || !request.method) {
						response.writeHead(500, 'Incomplete request');
						response.end();
						return;
					}
					localStorage.run(request, () => {
						handleRequest({
							pipeline,
							manifestData,
							controller,
							incomingRequest: request,
							incomingResponse: response,
							handler,
						});

						// writeFileSync(
						// 	'/Users/jopstad/Desktop/astro_module_keys.json',
						// 	JSON.stringify([...moduleRunner.moduleCache.keys()]),
						// );
					});
				});
			};
		},
		transform(code, id, opts = {}) {
			if (opts.ssr) return;
			if (!id.includes('vite/dist/client/client.mjs')) return;

			// Replace the Vite overlay with ours
			return patchOverlay(code);
		},
		resolveId(id) {
			if (id.startsWith('__ssr_environment/')) {
				return `\0virtual:${id}`;
			}
		},
		load(id) {
			if (id === '\0virtual:__ssr_environment/environment_context') {
				const s = JSON.stringify;

				const { manifestData } = environmentContext;

				return `
					export let manifest = {
						hrefRoot: ${s(settings.config.root.toString())},
						trailingSlash: ${s(settings.config.trailingSlash)},
						buildFormat: ${s(settings.config.build.format)},
						compressHTML: ${s(settings.config.compressHTML)},
						assets: new Set(),
						entryModules: {},
						routes: [],
						adapterName: ${s(settings?.adapter?.name || '')},
						clientDirectives: new Map(${s([...settings.clientDirectives])}),
						renderers: [],
						base: ${s(settings.config.base)},
						assetsPrefix: ${s(settings.config.build.assetsPrefix)},
						site: ${s(settings.config.site)},
						componentMetadata: new Map(),
						inlinedScripts: new Map(),
						i18n: ${s(
							settings.config.i18n && {
								fallback: settings.config.i18n.fallback,
								strategy: toRoutingStrategy(
									settings.config.i18n.routing,
									settings.config.i18n.domains,
								),
								defaultLocale: settings.config.i18n.defaultLocale,
								locales: settings.config.i18n.locales,
								domainLookupTable: {},
								fallbackType: toFallbackType(settings.config.i18n.routing),
							},
						)},
						checkOrigin: ${s(settings.config.security?.checkOrigin ?? false)},
						experimentalEnvGetSecretEnabled: false,

						// key: createKey(),

						middleware(_, next) {
							return next();
						},
					};

					export let manifestData = {
						routes: [
							${manifestData.routes
								.map(
									(route) => `
										{
											route: ${s(route.route)},
											component: ${s(route.component)},
											// generate
											params: ${s(route.params)},
											pathname: ${s(route.pathname)},
											distURL: ${route.distURL ? `new URL(${route.distURL})` : 'undefined'},
											pattern: ${route.pattern},
											segments: ${s(route.segments)},
											type: ${s(route.type)},
											prerender: ${s(route.prerender)},
											redirect: ${s(route.redirect)},
											// redirectRoute
											// fallbackRoutes
											isIndex: ${s(route.isIndex)}
										}
							`,
								)
								.join(',')}
						]
					}
				`;
			}
		},
	};
}

/**
 * It creates a `SSRManifest` from the `AstroSettings`.
 *
 * Renderers needs to be pulled out from the page module emitted during the build.
 * @param settings
 */
export function createDevelopmentManifest(settings: AstroSettings): SSRManifest {
	let i18nManifest: SSRManifestI18n | undefined = undefined;
	if (settings.config.i18n) {
		i18nManifest = {
			fallback: settings.config.i18n.fallback,
			strategy: toRoutingStrategy(settings.config.i18n.routing, settings.config.i18n.domains),
			defaultLocale: settings.config.i18n.defaultLocale,
			locales: settings.config.i18n.locales,
			domainLookupTable: {},
			fallbackType: toFallbackType(settings.config.i18n.routing),
		};
	}

	return {
		hrefRoot: settings.config.root.toString(),
		trailingSlash: settings.config.trailingSlash,
		buildFormat: settings.config.build.format,
		compressHTML: settings.config.compressHTML,
		assets: new Set(),
		entryModules: {},
		routes: [],
		adapterName: settings?.adapter?.name || '',
		clientDirectives: settings.clientDirectives,
		renderers: [],
		base: settings.config.base,
		assetsPrefix: settings.config.build.assetsPrefix,
		site: settings.config.site,
		componentMetadata: new Map(),
		inlinedScripts: new Map(),
		i18n: i18nManifest,
		checkOrigin: settings.config.security?.checkOrigin ?? false,
		experimentalEnvGetSecretEnabled: false,
		key: createKey(),
		middleware(_, next) {
			return next();
		},
	};
}
