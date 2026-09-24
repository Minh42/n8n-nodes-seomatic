import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

/** The only host this package ever talks to. */
export const BASE_URL = 'https://app.seomatic.ai';

const PLANS_URL = 'https://seomatic.ai/pricing';
const API_KEYS_HINT =
	'Check the API key in the SEOmatic credential. You can create or revoke keys in SEOmatic under Settings > AI Agents > API keys.';

type RequestContext = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions;

/** Tool names are snake_case identifiers; anything else never reaches the network. */
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** The fields SEOmatic uses when a tool answers with a refusal instead of data. */
const REFUSAL_FIELDS = new Set([
	'error',
	'code',
	'details',
	'existing',
	'connect_url',
	'next_step',
]);

interface ErrorLike {
	message?: string;
	httpCode?: string | number;
	statusCode?: number;
	status?: number;
	response?: { status?: number; body?: unknown; data?: unknown };
	cause?: { response?: { status?: number; body?: unknown; data?: unknown } };
	context?: { data?: unknown };
	description?: string;
}

function asObject(value: unknown): IDataObject | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) return value as IDataObject;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as IDataObject;
			}
		} catch {
			return undefined;
		}
	}
	return undefined;
}

/**
 * Pull the HTTP status and SEOmatic's JSON error body out of whatever the HTTP helper threw.
 * n8n wraps request failures in a NodeApiError whose `httpCode` holds the status, whose
 * `context.data` holds the parsed response body, and whose `cause` is the original error.
 */
function readHttpFailure(error: unknown): { status?: number; body?: IDataObject } {
	const e = (error ?? {}) as ErrorLike;
	const response = e.response ?? e.cause?.response;
	const rawStatus = response?.status ?? e.statusCode ?? e.status ?? e.httpCode ?? undefined;
	const status = rawStatus !== undefined && rawStatus !== null ? Number(rawStatus) : undefined;
	const body = asObject(response?.body) ?? asObject(response?.data) ?? asObject(e.context?.data);
	return { status: status !== undefined && Number.isFinite(status) ? status : undefined, body };
}

function text(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Turn an HTTP failure into an n8n error that says what happened and how to get unstuck.
 * `unavailableHint` explains, per operation, why SEOmatic may hide a tool from a key.
 */
export function toNodeApiError(
	context: RequestContext,
	error: unknown,
	options: { itemIndex?: number; unavailableHint?: string } = {},
): NodeApiError {
	const { status, body } = readHttpFailure(error);
	const serverMessage = text(body?.error);
	const code = text(body?.code);
	const details = text(body?.details);
	const upgradeUrl = text(body?.upgrade_url);

	let message =
		serverMessage ?? (error as ErrorLike)?.message ?? 'SEOmatic did not accept the request';
	let description: string | undefined;

	switch (status) {
		case 401:
			message = 'SEOmatic did not accept the API key';
			description = API_KEYS_HINT;
			break;
		case 403:
			message = serverMessage ?? 'This API key is not allowed to do this';
			description = options.unavailableHint ?? API_KEYS_HINT;
			break;
		case 402:
			if (code === 'AUTOMATION_NOT_ENTITLED') {
				message = 'The SEOmatic n8n integration needs the Infrastructure plan';
				description = `SEOmatic's n8n integration, like its Zapier integration, is part of the Infrastructure plan. Upgrade at ${upgradeUrl ?? PLANS_URL}.`;
			} else if (code === 'REST_ACT_REQUIRES_INFRA') {
				message = 'This operation needs the SEOmatic Infrastructure plan';
				description = `Operations that make changes (or read the agent's task board and tracked prompts) work through n8n on the Infrastructure plan only. Upgrade at ${upgradeUrl ?? PLANS_URL}.`;
			} else if (code === 'FREE_QUOTA_EXCEEDED') {
				message = 'The free monthly question allowance is used up';
				description = `Each call on the free plan uses one question. Upgrade for unlimited calls at ${upgradeUrl ?? PLANS_URL}, or wait for the allowance to reset next month.`;
			} else {
				description = upgradeUrl ? `Upgrade at ${upgradeUrl}.` : `See plans at ${PLANS_URL}.`;
			}
			break;
		case 404:
			if (code === 'UNKNOWN_TOOL') {
				message = 'This operation is not available for this API key';
				description = options.unavailableHint;
			}
			break;
		case 400:
			message = serverMessage ?? 'SEOmatic did not accept the parameters';
			description = details
				? `Check the node parameters. SEOmatic said: ${details}`
				: 'Check the node parameters.';
			break;
		case 413:
			description = 'Send less data in one call, for example fewer page URLs.';
			break;
		case 429:
			message = 'Too many requests to SEOmatic in a short time';
			description = "Wait a minute and try again, or turn on 'Retry On Fail' in the node settings.";
			break;
		case 502:
			description = details
				? `SEOmatic could not complete the request: ${details}. Try again in a few minutes.`
				: 'SEOmatic could not complete the request. Try again in a few minutes.';
			break;
		default:
			break;
	}

	if (error instanceof NodeApiError) {
		// Already wrapped by n8n's request helper: keep it, but say what happened in SEOmatic terms.
		if (serverMessage || status !== undefined) error.message = message;
		if (description) error.description = description;
		if (options.itemIndex !== undefined) error.context.itemIndex = options.itemIndex;
		return error;
	}

	return new NodeApiError(context.getNode(), (error ?? {}) as JsonObject, {
		message,
		description,
		httpCode: status !== undefined ? String(status) : undefined,
		itemIndex: options.itemIndex,
	});
}

/** One authenticated request to the SEOmatic REST API. */
export async function seomaticApiRequest(
	this: RequestContext,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	options: { itemIndex?: number; unavailableHint?: string } = {},
): Promise<IDataObject> {
	const request: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		json: true,
	};
	if (body !== undefined) request.body = body;
	try {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'seomaticApi',
			request,
		)) as unknown;
		return asObject(response) ?? {};
	} catch (error) {
		throw toNodeApiError(this, error, options);
	}
}

/**
 * Run one SEOmatic tool (POST /api/v1/tools/{name}) and return its parsed output.
 *
 * SEOmatic answers `{ tool, result }` where `result` is the tool's own output as a JSON string.
 * Tools report refusals inside that output (`{ error, code, ... }`) or ask for payment
 * (`{ status: 'payment_required', ... }`); both become node errors here, so a workflow never
 * treats a refusal as data.
 */
export async function callTool(
	this: RequestContext,
	tool: string,
	args: IDataObject,
	options: { itemIndex?: number; unavailableHint?: string } = {},
): Promise<IDataObject> {
	if (!TOOL_NAME.test(tool)) {
		throw new NodeOperationError(this.getNode(), `Unknown SEOmatic tool: ${tool}`, {
			itemIndex: options.itemIndex,
		});
	}
	const response = await seomaticApiRequest.call(
		this,
		'POST',
		`/api/v1/tools/${tool}`,
		args,
		options,
	);

	const raw = response.result;
	const output: IDataObject =
		asObject(raw) ?? (raw === undefined ? {} : { result: raw as IDataObject[keyof IDataObject] });

	const refusal = text(output.error);
	if (refusal && Object.keys(output).every((key) => REFUSAL_FIELDS.has(key))) {
		// A connect link is the actionable fix; next_step text is written for AI assistants.
		const connectUrl = text(output.connect_url);
		const code = text(output.code);
		throw new NodeOperationError(this.getNode(), refusal, {
			itemIndex: options.itemIndex,
			description: connectUrl
				? `Connect it at ${connectUrl}, then run the node again.`
				: code
					? `SEOmatic reason code: ${code}`
					: undefined,
		});
	}

	if (output.status === 'payment_required') {
		const buyUrl =
			text(output.buy_url) ??
			text((output.agentic_payment as IDataObject | undefined)?.mpp_payment_link);
		const price = text(output.price_per_article) ?? text(output.price_per_scan);
		throw new NodeOperationError(
			this.getNode(),
			text(output.message) ?? 'This operation needs a payment in SEOmatic first',
			{
				itemIndex: options.itemIndex,
				description: [
					price ? `Price: ${price}.` : undefined,
					buyUrl
						? `Top up at ${buyUrl}, then run the node again.`
						: 'Top up in SEOmatic, then run the node again.',
				]
					.filter(Boolean)
					.join(' '),
			},
		);
	}

	return output;
}

/** Remove empty values so optional fields are only sent when the user set them. */
export function compact(values: IDataObject): IDataObject {
	const result: IDataObject = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		result[key] = value;
	}
	return result;
}

/** Accept a list of URLs as an array or as text separated by commas, spaces, or new lines. */
export function toUrlList(value: unknown): string[] {
	const parts = Array.isArray(value) ? value.map(String) : String(value ?? '').split(/[\s,]+/);
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Why SEOmatic may hide an operation from a key (shown with the "not available" error). */
export const UNAVAILABLE_HINTS = {
	searchConsole:
		'Search Performance operations need Google Search Console connected in SEOmatic. Connect it at https://app.seomatic.ai/connect/gsc, then run the node again.',
	agent:
		"This operation needs an API key created with 'Allow this key to make changes' and the SEO agent turned on in SEOmatic. Create a new key under Settings > AI Agents > API keys and update the credential.",
	changes:
		"This operation needs an API key created with 'Allow this key to make changes'. Create a new key under Settings > AI Agents > API keys and update the credential.",
	general:
		'SEOmatic does not offer this operation to this API key. Check that the key belongs to the right workspace.',
} as const;
