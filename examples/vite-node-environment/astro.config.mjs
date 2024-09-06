import { defineConfig } from 'astro/config';
import { createNodeDevEnvironment } from 'vite';
import cloudflare from '@astrojs/cloudflare';

/**
 * @returns {import('vite').Plugin}
 */
export function node(environmentName) {
	return {
		name: 'vite-plugin-astro-node-environment',
		config: () => {
			return {
				environments: {
					[environmentName]: {
						dev: {
							// Should context contain `hot` rather than `ws`?
							createEnvironment: (name, config, context) => createNodeDevEnvironment(name, config, { ...context, hot: false })
						}
					}
				}
			}
		}
	}
}

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: {
		plugins: [node('__ssr_environment__')]
	},
});
