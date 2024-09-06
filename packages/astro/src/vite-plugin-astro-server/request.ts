import type http from 'node:http';
import type { ManifestData } from '../@types/astro.js';
import { removeTrailingForwardSlash } from '../core/path.js';
import type { DevServerController } from './controller.js';
import { runWithErrorHandling } from './controller.js';
import { recordServerError } from './error.js';
import type { DevPipeline } from './pipeline.js';
import { handle500Response } from './response.js';
import { handleRoute, handleRouteAlt, matchRoute } from './route.js';
import { createRequest } from '../core/request.js';

type HandleRequest = {
	pipeline: DevPipeline;
	manifestData: ManifestData;
	controller: DevServerController;
	incomingRequest: http.IncomingMessage;
	incomingResponse: http.ServerResponse;
};

/** The main logic to route dev server requests to pages in Astro. */
export async function handleRequest({
	pipeline,
	manifestData,
	controller,
	incomingRequest,
	incomingResponse,
	handler,
}: HandleRequest & { handler: any }) {
	const { config, loader, logger } = pipeline;
	const origin = `${loader.isHttps() ? 'https' : 'http'}://${
		incomingRequest.headers[':authority'] ?? incomingRequest.headers.host
	}`;

	const url = new URL(origin + incomingRequest.url);
	let pathname: string;
	if (config.trailingSlash === 'never' && !incomingRequest.url) {
		pathname = '';
	} else {
		pathname = url.pathname;
	}

	// Add config.base back to url before passing it to SSR
	url.pathname = removeTrailingForwardSlash(config.base) + url.pathname;

	let body: ArrayBuffer | undefined = undefined;
	if (!(incomingRequest.method === 'GET' || incomingRequest.method === 'HEAD')) {
		let bytes: Uint8Array[] = [];
		await new Promise((resolve) => {
			incomingRequest.on('data', (part) => {
				bytes.push(part);
			});
			incomingRequest.on('end', resolve);
		});
		body = Buffer.concat(bytes);
	}

	const request = createRequest({
		base: config.base,
		url,
		headers: incomingRequest.headers,
		method: incomingRequest.method,
		body,
		logger,
		clientAddress: incomingRequest.socket.remoteAddress,
		// need to apply staticLike inside the environment when the route is available
		staticLike: false,
	});

	await runWithErrorHandling({
		controller,
		pathname,
		async run() {
			return await handleRouteAlt({ request, incomingResponse, handler });
		},
		// async run() {
		// 	const matchedRoute = await matchRoute(pathname, manifestData, pipeline);
		// 	const resolvedPathname = matchedRoute?.resolvedPathname ?? pathname;
		// 	return await handleRoute({
		// 		matchedRoute,
		// 		url,
		// 		pathname: resolvedPathname,
		// 		body,
		// 		origin,
		// 		pipeline,
		// 		manifestData,
		// 		incomingRequest: incomingRequest,
		// 		incomingResponse: incomingResponse,
		// 	});
		// },
		onError(_err) {
			const { error, errorWithMetadata } = recordServerError(loader, config, pipeline, _err);
			handle500Response(loader, incomingResponse, errorWithMetadata);
			return error;
		},
	});
}
