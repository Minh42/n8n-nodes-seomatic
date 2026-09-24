# n8n-nodes-seomatic

This is an n8n community node package. It lets you use [SEOmatic](https://seomatic.ai) in your n8n workflows: read insights from your own Google Search Console data, audit pages, track how AI assistants mention your brand, order articles, and approve the changes SEOmatic's SEO agent proposes.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

The package contains two nodes:

- **SEOmatic**: actions on six resources (Search Performance, Site Audit, AI Visibility, Tracked Prompt, SEO Task, Article).
- **SEOmatic Trigger**: starts a workflow when something happens in SEOmatic (a task awaits approval, a page is published, a scan completes, and more).

[Installation](#installation) · [Credentials](#credentials) · [Plans and costs](#plans-and-costs) · [Operations](#operations) · [SEOmatic Trigger](#seomatic-trigger) · [Example workflows](#example-workflows) · [Compatibility](#compatibility) · [Version history](#version-history) · [Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management) in the n8n community nodes documentation. On self-hosted n8n, an owner or admin opens **Settings > Community nodes > Install**, enters `n8n-nodes-seomatic`, and ticks **I understand the risks of installing unverified code from a public source**. On n8n Cloud, until n8n verifies the node, use SEOmatic's [Zapier](https://seomatic.ai/developers/zapier) or [Make](https://seomatic.ai/developers/make) integration.

## Credentials

Both nodes use one **SEOmatic API** credential, which holds a SEOmatic API key.

1. Create a SEOmatic account at [seomatic.ai](https://seomatic.ai). For Search Performance operations, connect Google Search Console in SEOmatic.
2. In SEOmatic, open **Settings > AI Agents > API keys** and create a key. It starts with `smk_`.
   - Leave **Allow this key to make changes** off for a read-only key.
   - Turn it on for operations that change something (see [Plans and costs](#plans-and-costs)).
3. In n8n, create a **SEOmatic API** credential and paste the key. n8n checks it against SEOmatic when you save.

The key is sent only to `https://app.seomatic.ai`, as a bearer token. You can revoke it at any time in SEOmatic.

## Plans and costs

The SEOmatic n8n integration is available on the **Infrastructure** plan, like SEOmatic's Zapier integration. On other plans the credential test tells you so, with a link to upgrade.

| Operations | What they need |
| --- | --- |
| Search Performance, Site Audit, AI Visibility > Get | Any API key. Search Performance also needs Google Search Console connected in SEOmatic. |
| Article > Generate | A prepaid article balance ($9 per article). Get and Get Many are free reads. |
| AI Visibility > Run Scan, Tracked Prompt (all), SEO Task (all) | An API key created with **Allow this key to make changes**. SEO Task operations also need the SEO agent turned on in SEOmatic. |
| SEOmatic Trigger | A public `https://` address for your n8n instance. |

Operations that spend money or credits say so in their description:

- **Article > Generate** costs $9 from the prepaid article balance. With an empty balance the node stops with the price and a link to top up.
- **AI Visibility > Run Scan** uses AI credits from the workspace. If they cannot cover it, no scan starts and the node outputs a normal item with `status: "insufficient_credits"` (not an error, so check `status`): workflows never spend prepaid scans. One scan per hour can be started this way.
- **SEO Task > Approve** and **Execute** start work that uses AI credits.
- **Tracked Prompt > Create** is free, but each active prompt adds to the cost of every future scan.

See [seomatic.ai/pricing](https://seomatic.ai/pricing).

## Operations

### Search Performance

Data from your own Google Search Console property.

| Operation | What it does | Parameters |
| --- | --- | --- |
| Get Queries | The searches people use to find your site, one item per query (clicks, impressions, click rate, position). | Limit (1 to 1000). Options: Days (1 to 90, default 28). |
| Get Pages | Your pages that get the most clicks from Google, one item per page. | Limit (1 to 1000). Options: Days (1 to 90, default 28). |
| Compare Periods | Compares the latest period with the one right before it and lists the biggest losers and winners by clicks. | Options: Compare By (Page or Search Query), Days (7 to 45, default 28), Rows Per Period (10 to 10000, default 500). |
| Find Competing Pages | Searches where two or more of your pages compete and split the clicks. | Options: Days (7 to 90), Minimum Impressions (default 100). |
| Find Low Click Rate Pages | Pages that get far fewer clicks than their position should earn, with the estimated missed clicks. Usually fixed with a better title and description. | Options: Days (7 to 90), Minimum Impressions (default 200). |
| Get Monthly Trend | 16 months of monthly clicks and impressions with a year-over-year verdict: real drop or seasonal dip. | None. |
| Check Indexing | Whether Google has indexed a page, and why not. | Page URL, Simplify. |

### Site Audit

| Operation | What it does | Parameters |
| --- | --- | --- |
| Run | Crawls up to 30 pages and finds issues across pages: dead pages, broken internal links, duplicate titles and descriptions, missing descriptions, thin content, pages hidden from Google, canonical mismatches, redirects, slow pages. | Options: Page URLs (up to 30, separated by commas or new lines) or Number of Pages (3 to 30, default 20). Simplify returns a count per issue. |
| Analyze Page | Scores one page from 0 to 100 and lists its issues by severity. | Page URL, Simplify. |

### AI Visibility

| Operation | What it does | Parameters |
| --- | --- | --- |
| Get | Reads the latest completed AI visibility scan: visibility per AI engine (ChatGPT, Claude, Gemini, Perplexity, and others), the prompts where your brand was missed, top competitors. Free: never starts a scan. | Options: Scan ID. Simplify. |
| Run Scan | Starts a new scan of your site or a competitor. Returns a scan ID right away; the scan takes a few minutes. Read it with **Get** or the **AI Visibility Scan Completed** trigger event. | Options: Competitor Domain. |

### Tracked Prompt

The questions your AI visibility monitor asks every AI engine.

| Operation | What it does | Parameters |
| --- | --- | --- |
| Create | Adds a tracked prompt. Limited by your plan. | Prompt. Options: Language Code and Location Code (set both, or neither for your main monitor). |
| Get Many | Lists tracked prompts, one item per prompt. | Return All, Limit. Options: Language Code, Location Code. |
| Update | Changes the wording, pins it, or pauses and resumes it. | Tracked Prompt (from list or ID). Update Fields: Prompt, Pinned, Active. |
| Delete | Deletes a tracked prompt. Past scan results are kept. Returns `{"deleted": true}`. | Tracked Prompt (from list or ID). |

### SEO Task

The work SEOmatic's SEO agent proposes, runs, and measures.

| Operation | What it does | Parameters |
| --- | --- | --- |
| Get Many | Lists tasks on the agent's board, highest priority first, one item per task. SEOmatic returns up to 20 tasks. | Max Tasks (1 to 20). Filters: Status, Type. Simplify. |
| Get | One task with its reasoning, expected impact, and latest activity. The raw output includes `stagedReview` when the agent held a change for review. | Task (from list or ID), Simplify. |
| Approve | Approves a proposed task so it runs through the agent's safety checks. Tasks that hide a page from Google (noindex) or redirect it also need **Confirm Noindex or Redirect**, which you should turn on only after a person reviewed that exact page. | Task. Options: Confirm Noindex or Redirect. |
| Dismiss | Dismisses a proposed task and archives it. | Task. |
| Execute | Runs an approved task now, or releases a change the agent held for review. Approve already starts most tasks within seconds; the Approve output says when it did not. | Task. Options: Confirm Noindex or Redirect, Review Token (from `stagedReview.reviewToken` in the raw Get output, only after a person approved the held content). |
| Roll Back | Restores the page as it was before the agent's edit. If someone edited the page afterwards, SEOmatic refuses unless **Overwrite Newer Edits** is on. The undo runs in the background: check the result with Get. | Task. Options: Overwrite Newer Edits. |

### Article

Pay-as-you-go articles, no subscription needed.

| Operation | What it does | Parameters |
| --- | --- | --- |
| Generate | Orders one in-depth SEO article ($9 from the prepaid balance). Returns an `article_id` right away; writing takes a few minutes. | Topic. |
| Get | One article with its status and, once `ready`, its markdown and HTML. Simplify drops the HTML copy. | Article (from list or ID), Simplify. |
| Get Many | Your 20 most recent articles, one item per article. | Return All, Limit. |

### Errors

The node tells you what happened and how to fix it: a missing Google Search Console connection (with the connect link), a key without permission to make changes, a plan that does not include the operation (with the upgrade link), an empty article balance (with the top-up link), or a used-up free allowance. Turn on **Continue On Fail** in the node settings to get these as items with an `error` field instead of stopping the workflow.

### Using the node with AI agents

The SEOmatic node can be used as a tool by n8n AI agents. **With AI agents, use a read-only key.** An AI agent can be steered by text it reads (prompt injection). A read-only key means the worst it can do is read your SEO data; it can never approve or apply a change.

## SEOmatic Trigger

Starts a workflow when one of these events happens:

| Event | When |
| --- | --- |
| SEO Task Awaiting Approval | The SEO agent proposed a task that needs your decision. |
| SEO Task Completed | A task finished running. |
| Campaign Completed | Every task in a campaign has settled. |
| Page Published | A page went live on your site. |
| Page Publish Failed | SEOmatic could not publish a page. |
| AI Visibility Scan Completed | A scan finished, with results per AI engine. |

When you activate the workflow, the trigger registers your n8n webhook address with SEOmatic for the chosen events, and removes it when you deactivate the workflow. Each event arrives as one item:

```json
{
  "event": "task.awaiting_approval",
  "workspace_id": "...",
  "created_at": "2026-09-24T10:00:00.000Z",
  "data": {
    "task_id": "...",
    "type": "ctr_fix",
    "title": "Rewrite the title of /pricing",
    "target": "https://example.com/pricing",
    "approve_in_app": "https://app.seomatic.ai/dashboard/agents"
  }
}
```

Every delivery is signed. The trigger checks the `X-Seomatic-Signature` header (HMAC-SHA256 of the timestamp and body with the secret SEOmatic returned when the webhook was registered), refuses deliveries older than five minutes, and ignores anything that does not match.

Requirements: the Infrastructure plan, and a public `https://` address for n8n (n8n Cloud has one; on self-hosted n8n set `WEBHOOK_URL`). With an `http://` address, activation (or "Listen for test event" on `localhost`) fails with "SEOmatic can only send events to an https:// address"; SEOmatic also refuses private addresses. A workspace can have up to 25 webhook endpoints: each active trigger, and each "Listen for test event" while it listens, registers one.

## Example workflows

- **Approve SEO fixes from Slack**: SEOmatic Trigger (SEO Task Awaiting Approval) > Slack (Send and Wait for Response, approval buttons) > IF approved > SEOmatic (SEO Task > Approve or Dismiss, with the task ID from the trigger).
- **Weekly SEO report**: Schedule Trigger (Monday 8:00) > SEOmatic (Search Performance > Compare Periods) > SEOmatic (Search Performance > Find Low Click Rate Pages) > Gmail or Slack.
- **Real traffic drop alarm**: Schedule Trigger (daily) > SEOmatic (Search Performance > Get Monthly Trend) > IF (`yoy.verdict` starts with "Real decline") > Slack.
- **Indexing watch for new pages**: SEOmatic Trigger (Page Published) > Wait (3 days) > SEOmatic (Search Performance > Check Indexing with `{{ $json.data.url }}`) > IF (verdict is not PASS) > email.
- **AI visibility tracker**: SEOmatic Trigger (AI Visibility Scan Completed) > SEOmatic (AI Visibility > Get) > Google Sheets (append a row per engine).
- **Article pipeline**: Google Sheets (topics) > SEOmatic (Article > Generate) > Wait (10 minutes) > SEOmatic (Article > Get) > your CMS.
- **Site health check after a release**: Webhook or GitHub trigger > SEOmatic (Site Audit > Run with the changed page URLs) > IF (broken internal links > 0) > alert.

## Compatibility

Built with the `@n8n/node-cli` tooling against the current `n8n-workflow` API (`n8nNodesApiVersion: 1`). No runtime dependencies. The node does not read environment variables or files.

## Version history

- **2.0.0**: Rebuilt as a resource and operation node (Search Performance, Site Audit, AI Visibility, Tracked Prompt, SEO Task, Article) with typed fields, Simplify output, lists to pick tasks, prompts, and articles, clear errors, and the new SEOmatic Trigger. **Breaking**: the 1.x "Tool + Arguments (JSON)" fields are gone, so workflows built with 1.x need their SEOmatic nodes set up again with the matching operation.
- **1.0.1**: First release: one generic node that ran any SEOmatic tool by name with JSON arguments.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [SEOmatic API reference](https://seomatic.ai/developers/rest-api)
- [SEOmatic webhooks](https://seomatic.ai/developers/webhooks)
- [SEOmatic developers](https://seomatic.ai/developers)

## License

[MIT](LICENSE)
