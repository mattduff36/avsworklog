import { z } from 'zod';
import { TRUCK_CHECKLIST_ITEMS } from './vehicle-checklists';

export const HgvTrailerSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fleet'), trailerHgvId: z.string().uuid() }).strict(),
  z.object({
    kind: z.literal('hired'),
    hiredTrailerId: z.string().trim().min(1).max(100),
    hiredTrailerCompany: z.string().trim().min(1).max(150),
  }).strict(),
  z.object({ kind: z.literal('none') }).strict(),
]);
export type HgvTrailerSelection = z.infer<typeof HgvTrailerSelectionSchema>;

export const HGV_TRAILER_SWAP_ITEM_NUMBERS = [9, 10, 12, 13, 14, 18, 19, 20, 21, 23, 24, 25, 26] as const;

export const HgvTrailerSwapSchema = z.object({
  requestId: z.string().uuid(),
  trailerSelection: HgvTrailerSelectionSchema.refine(selection => selection.kind !== 'none'),
  signatureData: z.string().startsWith('data:image/png;base64,').min(23).max(1_000_000),
  items: z.array(z.object({
    item_number: z.number().int(),
    item_description: z.string(),
    status: z.enum(['ok', 'attention', 'na']),
    comments: z.string().trim().max(3000).nullable(),
  }).strict()).length(HGV_TRAILER_SWAP_ITEM_NUMBERS.length),
}).strict().superRefine((body, ctx) => {
  const numbers = new Set(body.items.map(item => item.item_number));
  if (HGV_TRAILER_SWAP_ITEM_NUMBERS.some(number => !numbers.has(number))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Complete every trailer check' });
  }
  for (const [index, item] of body.items.entries()) {
    if (item.item_description !== TRUCK_CHECKLIST_ITEMS[item.item_number - 1]
        || (item.status === 'attention' && !item.comments)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items', index], message: 'Invalid trailer check or missing defect comment' });
    }
  }
});
