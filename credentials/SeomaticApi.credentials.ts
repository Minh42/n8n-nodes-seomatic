import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class SeomaticApi implements ICredentialType {
	name = 'seomaticApi';

	displayName = 'SEOmatic API';

	icon: Icon = {
		light: 'file:../nodes/Seomatic/seomatic.svg',
		dark: 'file:../nodes/Seomatic/seomatic.dark.svg',
	};

	documentationUrl = 'https://github.com/Minh42/n8n-nodes-seomatic?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create one in SEOmatic under Settings > AI Agents > API keys. It starts with smk_.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://app.seomatic.ai',
			url: '/api/v1/me',
		},
	};
}
