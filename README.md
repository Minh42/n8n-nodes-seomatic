# n8n-nodes-seomatic

This is an n8n community node. It lets you use [SEOmatic](https://seomatic.ai) in your n8n workflows: SEO analysis over your own Google Search Console data, and SEOmatic's approval-gated SEO agents.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation) · [Credentials](#credentials) · [Usage](#usage) · [Example workflows](#example-workflows) · [Plans](#plans) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. In a self-hosted n8n: **Settings > Community nodes > Install**, then enter `n8n-nodes-seomatic`.

## Credentials

The node authenticates with a SEOmatic API key.

1. Create a SEOmatic account at [seomatic.ai](https://seomatic.ai) and connect Google Search Console.
2. In SEOmatic, open **Settings > AI Agents > API keys** and create a key. It starts with `smk_`.
3. In n8n, create a **SEOmatic API** credential and paste the key. n8n checks it against SEOmatic when you save.

## Usage

The node has two fields:

- **Tool**: the SEOmatic tool to run. The list loads live from your API key, so it always shows exactly the tools your key can run.
- **Arguments**: the tool's arguments as JSON, for example `{"days": 28, "limit": 50}`. Each tool's arguments are listed in the [SEOmatic API reference](https://seomatic.ai/developers/rest-api).

The node returns `{ "tool": "...", "result": { ... } }`, with `result` holding the tool's output as fields you can use in the next node.

The node can also be used as a tool by n8n AI agents.

### Security

- The node only ever sends your API key to `https://app.seomatic.ai`. It has no dependencies and does not read environment variables or files.
- API keys are read-only by default. Only a key created with **Allow this key to make changes** can act, and only on the Infrastructure plan.
- **With AI agents, use a read-only key.** An AI agent can be steered by text it reads (prompt injection). A read-only key means the worst it can do is read your SEO data; it can never approve or apply a change.
- You can revoke a key at any time in **Settings > AI Agents > API keys**.

## Example workflows

- **Weekly SEO report**: Schedule Trigger > SEOmatic (`compare_periods`) > format > email or Slack.
- **Traffic-drop alarm**: Schedule Trigger > SEOmatic (`get_seasonality_baseline`, then `compare_periods`) > IF the drop is real > alert.
- **Approve staged fixes from a workflow** (Infrastructure plan, see below): SEOmatic (`list_seo_tasks`) > filter > SEOmatic (`decide_seo_task`).

## Plans

- **Reading and analysis** tools work on every plan, including the free plan (which has a monthly question quota).
- **Agent actions** over the API (tools that change something, such as deciding on a staged task) require the **Infrastructure** plan. Every change an agent makes still waits for approval in SEOmatic unless you have chosen otherwise.

See [seomatic.ai/pricing](https://seomatic.ai/pricing).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [SEOmatic API reference](https://seomatic.ai/developers/rest-api)
- [SEOmatic developers](https://seomatic.ai/developers)

## License

[MIT](LICENSE)
