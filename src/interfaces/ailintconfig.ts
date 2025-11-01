export interface ApiConfig {
  baseUrl: string;
  modelName: string;
  apiKey: string;
  temperature: string;
}

export interface AilintConfig {
  baseConfig: 'empty' | 'default';
  includeExtensions?: string[];
  includeMimeTypes?: string[];
  ignore?: string[];
  useGitIgnore?: boolean;
  apiConfig?: ApiConfig;
  apiConfigRuleOverrides?: { [rulePattern: string]: Partial<ApiConfig> };
}
