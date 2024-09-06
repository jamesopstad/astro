import type { AstroSettings, SSRManifest } from '../../@types/astro.js';
import type { SSRManifestI18n } from '../../core/app/types.js';
import { toFallbackType, toRoutingStrategy } from '../../i18n/utils.js';
import { createKey } from '../../core/encryption.js';

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
