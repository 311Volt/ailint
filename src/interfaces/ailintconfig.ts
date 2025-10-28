export interface AilintConfig {
  baseConfig: 'empty' | 'default';
  includeExtensions?: string[];
  includeMimeTypes?: string[];
  ignore?: string[];
}
