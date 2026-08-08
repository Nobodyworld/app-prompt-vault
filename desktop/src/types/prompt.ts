export interface PromptVersionSummary {
  id: string;
  semanticVersion: string;
  changelog?: string | null;
  createdAt?: string;
  updatedAt: string;
  body: string;
}

export interface PromptSummary {
  id: string;
  slug: string;
  title: string;
  description?: string;
  category?: string | null;
  isFavorite: boolean;
  rating?: number | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  latestVersion?: PromptVersionSummary;
}

export interface CreatePromptInput {
  slug: string;
  title: string;
  description?: string;
  category?: string;
  isFavorite?: boolean;
  rating?: number | null;
  body: string;
  semanticVersion: string;
  changelog?: string;
  tags: string[];
}

export interface AddPromptVersionInput {
  promptId: string;
  body: string;
  semanticVersion: string;
  changelog?: string;
}

export interface UpdatePromptInput {
  id: string;
  title?: string;
  description?: string;
  category?: string | null;
  isFavorite?: boolean;
  rating?: number | null;
  tags?: string[];
}
