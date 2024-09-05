export default {
	fetch: async (request: Request) => {
		return new Promise((resolve) => resolve(new Response('Hello from entrypoint')));
	},
};
