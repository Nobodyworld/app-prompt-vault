export interface PromptVersionSummary {
  id: string;
  semanticVersion: string;
  updatedAt: string;
}

export interface PromptSummary {
  id: string;
  slug: string;
  title: string;
  description?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  latestVersion?: PromptVersionSummary;
}

export interface CreatePromptInput {
  slug: string;
  title: string;
  description?: string;
  body: string;
  semanticVersion: string;
  changelog?: string;
  tags: string[];
}
