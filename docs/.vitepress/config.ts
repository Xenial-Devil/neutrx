import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Neutrx',
  description: 'Secure-by-default HTTP client documentation for Node.js backend services.',
  base: '/neutrx/',
  outDir: '../dist-docs',
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Migration', link: '/axios-migration' },
      { text: 'API', link: '/api' },
      { text: 'Examples', link: '/examples/rest-api-request' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Axios Migration Guide', link: '/axios-migration' },
          { text: 'Full-Stack Frontend Migration', link: '/full-stack-frontend-migration' },
          { text: 'Why Neutrx', link: '/why-neutrx' },
          { text: 'Support', link: '/support' },
        ],
      },
      {
        text: 'Core Usage',
        items: [
          { text: 'Node Usage', link: '/node-usage' },
          { text: 'Node Infrastructure', link: '/node-infrastructure' },
          { text: 'Browser Usage', link: '/browser-usage' },
          { text: 'Full-Stack Frontend Migration', link: '/full-stack-frontend-migration' },
          { text: 'Security Features', link: '/security-features' },
          { text: 'Retry Strategies', link: '/retries' },
          { text: 'Circuit Breaker', link: '/circuit-breaker' },
          { text: 'Bulkhead Isolation', link: '/bulkhead-isolation' },
          { text: 'Plugins', link: '/plugins' },
        ],
      },
      {
        text: 'Examples',
        items: [
          { text: 'REST API Request', link: '/examples/rest-api-request' },
          { text: 'Auth Token', link: '/examples/auth-token' },
          { text: 'File Upload', link: '/examples/file-upload' },
          { text: 'Request Retry', link: '/examples/request-retry' },
          { text: 'OTel Tracing', link: '/examples/otel-tracing' },
          { text: 'Schema Validation', link: '/examples/schema-validation' },
          { text: 'Docker Socket Request', link: '/examples/docker-socket-request' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API Reference', link: '/api' },
          { text: 'Config Reference', link: '/config-reference' },
          { text: 'Node Infrastructure', link: '/node-infrastructure' },
          { text: 'Errors', link: '/errors' },
          { text: 'Cache', link: '/cache' },
          { text: 'Observability', link: '/observability' },
          { text: 'Secure Egress', link: '/secure-egress' },
          { text: 'Adapter Security Contract', link: '/adapter-security-contract' },
          { text: 'Backend Recipes', link: '/recipes/backend-recipes' },
        ],
      },
    ],
    search: {
      provider: 'local',
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/Xenial-Devil/neutrx' },
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright (c) Neutrx contributors',
    },
  },
});
