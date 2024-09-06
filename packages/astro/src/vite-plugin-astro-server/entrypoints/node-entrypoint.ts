export default {
	fetch: async (request: Request) => {
		// @ts-ignore
		const environmentContext = await import('__ssr_environment/environment_context');

		console.log('context', environmentContext.manifestData);

		// console.log('manifest', environmentContext.manifestData);

		return new Promise((resolve) => resolve(new Response('Hello from entrypoint')));
	},
};
