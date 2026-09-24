import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { seomaticApiRequest, toNodeApiError } from '../Seomatic/GenericFunctions';

/** How old a delivery may be before it is refused as a possible replay. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const WEBHOOKS_HINT =
	'Webhooks need the SEOmatic Infrastructure plan and a public https:// address for n8n. See https://seomatic.ai/pricing.';

interface WebhookEndpoint {
	id?: string;
	url?: string;
	events?: string[];
}

/** Parse `t=<unix seconds>,v1=<hex>[,v1=<hex>]` into its timestamp and signatures. */
export function parseSignatureHeader(header: string): { timestamp?: number; signatures: string[] } {
	let timestamp: number | undefined;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, ...rest] = part.trim().split('=');
		const value = rest.join('=').trim();
		if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
		if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
	}
	return { timestamp, signatures };
}

/**
 * Check an `X-Seomatic-Signature` header: HMAC-SHA256 of `${timestamp}.${rawBody}` with the
 * endpoint secret, compared in constant time. During a secret rotation SEOmatic sends two
 * v1 values; one match is enough.
 */
export function verifySignature(
	secret: string,
	header: string,
	rawBody: string,
	nowSeconds: number,
): boolean {
	const { timestamp, signatures } = parseSignatureHeader(header);
	if (timestamp === undefined || signatures.length === 0) return false;
	if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
	const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
	return signatures.some((signature) => {
		const received = Buffer.from(signature, 'hex');
		return received.length === expected.length && timingSafeEqual(received, expected);
	});
}

const sameEvents = (a: string[] = [], b: string[] = []) =>
	a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export class SeomaticTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SEOmatic Trigger',
		name: 'seomaticTrigger',
		icon: { light: 'file:../Seomatic/seomatic.svg', dark: 'file:../Seomatic/seomatic.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Start a workflow when something happens in SEOmatic',
		defaults: { name: 'SEOmatic Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'seomaticApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"SEOmatic webhooks need the Infrastructure plan, and SEOmatic only sends events to public https:// addresses. Every event is signed; this node checks the signature and ignores anything that doesn't match.",
				name: 'webhookNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'The events that start the workflow',
				options: [
					{
						name: 'AI Visibility Scan Completed',
						value: 'ai_visibility.scan_completed',
						description: 'An AI visibility scan finished, with per-engine results',
					},
					{
						name: 'Campaign Completed',
						value: 'campaign.completed',
						description: 'Every task in an SEO campaign has settled',
					},
					{
						name: 'Page Publish Failed',
						value: 'page.publish_failed',
						description: 'SEOmatic could not publish a page to your site',
					},
					{
						name: 'Page Published',
						value: 'page.published',
						description: 'A page went live on your site',
					},
					{
						name: 'SEO Task Awaiting Approval',
						value: 'task.awaiting_approval',
						description: 'The SEO agent proposed a task that needs your decision',
					},
					{
						name: 'SEO Task Completed',
						value: 'task.completed',
						description: 'An SEO agent task finished running',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events', []) as string[];
				if (!webhookData.webhookId) return false;

				const response = await seomaticApiRequest.call(this, 'GET', '/api/v1/webhooks', undefined, {
					unavailableHint: WEBHOOKS_HINT,
				});
				const endpoints = (response.endpoints as WebhookEndpoint[] | undefined) ?? [];
				const existing = endpoints.find((endpoint) => endpoint.id === webhookData.webhookId);
				if (!existing) {
					delete webhookData.webhookId;
					delete webhookData.webhookSecret;
					return false;
				}
				if (existing.url === webhookUrl && sameEvents(existing.events, events)) return true;

				// The address or events changed: remove the old registration so create() can replace it.
				await seomaticApiRequest.call(this, 'DELETE', `/api/v1/webhooks/${existing.id}`);
				delete webhookData.webhookId;
				delete webhookData.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events', []) as string[];

				if (!webhookUrl || !webhookUrl.startsWith('https://')) {
					throw new NodeOperationError(
						this.getNode(),
						'SEOmatic can only send events to an https:// address',
						{
							description:
								'Set a public https:// address for n8n (the WEBHOOK_URL setting on self-hosted n8n), then activate the workflow again.',
						},
					);
				}
				if (events.length === 0) {
					throw new NodeOperationError(this.getNode(), 'No events selected', {
						description: "Choose at least one event in 'Events'.",
					});
				}

				const response = await seomaticApiRequest.call(
					this,
					'POST',
					'/api/v1/webhooks',
					{ url: webhookUrl, events },
					{ unavailableHint: WEBHOOKS_HINT },
				);
				const endpoint = response.endpoint as WebhookEndpoint | undefined;
				const secret = response.secret;
				if (!endpoint?.id || typeof secret !== 'string' || !secret) {
					throw new NodeOperationError(
						this.getNode(),
						'SEOmatic did not return the webhook details',
						{
							description: 'Try activating the workflow again in a few minutes.',
						},
					);
				}
				webhookData.webhookId = endpoint.id;
				webhookData.webhookSecret = secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				if (webhookData.webhookId) {
					try {
						await seomaticApiRequest.call(
							this,
							'DELETE',
							`/api/v1/webhooks/${String(webhookData.webhookId)}`,
						);
					} catch (error) {
						// Already removed in SEOmatic: nothing left to clean up there.
						if (!(error instanceof NodeApiError) || error.httpCode !== '404') {
							throw toNodeApiError(this, error);
						}
						this.logger.debug('SEOmatic webhook was already removed', {
							webhookId: webhookData.webhookId,
						});
					}
				}
				delete webhookData.webhookId;
				delete webhookData.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const webhookData = this.getWorkflowStaticData('node');
		const secret = webhookData.webhookSecret;
		const request = this.getRequestObject();
		const headers = this.getHeaderData();
		const signature = headers['x-seomatic-signature'];
		const rawBody = request.rawBody
			? request.rawBody.toString('utf8')
			: JSON.stringify(request.body);

		const valid =
			typeof secret === 'string' &&
			typeof signature === 'string' &&
			verifySignature(secret, signature, rawBody, Math.floor(Date.now() / 1000));

		if (!valid) {
			const response = this.getResponseObject();
			response.status(401).json({ error: 'Invalid signature' });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData();
		const events = this.getNodeParameter('events', []) as string[];
		if (typeof body.event === 'string' && events.length > 0 && !events.includes(body.event)) {
			// Signed, but not an event this workflow listens to: acknowledge without starting it.
			return { webhookResponse: { received: true } };
		}

		return { workflowData: [this.helpers.returnJsonArray([body])] };
	}
}
