# n8n-nodes-seomatic

[SEOmatic](https://seomatic.ai) for n8n: AI SEO analysis over your own Google
Search Console data, plus approval-gated agent actions on paid plans.

## What it does

One node, every SEOmatic tool. The tool list loads live from your API key, so
free keys see the free insight tools (Search Console performance,
striking-distance keywords, cannibalization, CTR outliers, seasonality
verdicts, site audits...) and paid keys additionally see agent actions
(staging fixes, campaigns - always human-approval-gated in SEOmatic).

## Setup

1. Create a free SEOmatic account at https://seomatic.ai and connect Google
   Search Console.
2. Settings > Integrations > API Keys > create a key (starts with `smk_`).
3. In n8n: install this community package, add SEOmatic credentials with the
   key, drop the SEOmatic node into a workflow.

## Example workflows

- **Weekly SEO report to Slack/email**: Cron -> SEOmatic (`compare_periods`)
  -> format -> send.
- **Traffic-drop alarm**: Cron -> SEOmatic (`get_seasonality_baseline` +
  `compare_periods`) -> IF real drop -> alert.
- **Approve staged fixes from your workflow**: SEOmatic
  (`list_seo_tasks`) -> filter -> SEOmatic (`decide_seo_task`).

## Pricing

Free plan covers analysis tools with a monthly question quota. Agent actions
require a paid plan (from $99/month). https://seomatic.ai/pricing

## License

MIT
