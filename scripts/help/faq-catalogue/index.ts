import { ADMIN_ARTICLES } from './articles-admin';
import { CORE_ARTICLES } from './articles-core';
import { INVENTORY_ARTICLES } from './articles-inventory';
import { OPS_ARTICLES } from './articles-ops';
import { QUOTES_ARTICLES } from './articles-quotes';
import { TRAINING_ARTICLES } from './articles-training';
import { FAQ_CATEGORIES } from './categories';
import type { FAQArticleDef, FAQCategoryDef } from './types';

export type { FAQArticleDef, FAQCategoryDef };

export const FAQ_CATALOGUE_CATEGORIES: FAQCategoryDef[] = FAQ_CATEGORIES;

export const FAQ_CATALOGUE_ARTICLES: FAQArticleDef[] = [
  ...CORE_ARTICLES,
  ...INVENTORY_ARTICLES,
  ...QUOTES_ARTICLES,
  ...TRAINING_ARTICLES,
  ...OPS_ARTICLES,
  ...ADMIN_ARTICLES,
];

export function assertCatalogueIntegrity(): void {
  const categorySlugs = new Set(FAQ_CATALOGUE_CATEGORIES.map((category) => category.slug));
  const articleKeys = new Set<string>();

  for (const article of FAQ_CATALOGUE_ARTICLES) {
    if (!categorySlugs.has(article.category_slug)) {
      throw new Error(`Article ${article.slug} references unknown category ${article.category_slug}`);
    }

    const key = `${article.category_slug}:${article.slug}`;
    if (articleKeys.has(key)) {
      throw new Error(`Duplicate article key ${key}`);
    }
    articleKeys.add(key);
  }
}
