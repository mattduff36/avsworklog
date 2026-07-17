export interface FAQCategoryDef {
  slug: string;
  name: string;
  description: string;
  module_name: string | null;
  sort_order: number;
}

export interface FAQArticleDef {
  category_slug: string;
  slug: string;
  title: string;
  summary: string;
  content_md: string;
  sort_order: number;
}

export function article(
  category_slug: string,
  slug: string,
  title: string,
  summary: string,
  content_md: string,
  sort_order: number
): FAQArticleDef {
  return { category_slug, slug, title, summary, content_md, sort_order };
}
