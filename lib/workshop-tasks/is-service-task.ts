export function isServiceWorkshopCategoryName(categoryName: string | null | undefined): boolean {
  return /^service(\s|\(|$)/i.test(categoryName || '');
}

export function isServiceWorkshopTask(task: {
  workshop_task_categories?: { name?: string | null } | null;
  workshop_task_subcategories?: {
    workshop_task_categories?: { name?: string | null } | null;
  } | null;
}): boolean {
  return (
    isServiceWorkshopCategoryName(task.workshop_task_categories?.name) ||
    isServiceWorkshopCategoryName(
      task.workshop_task_subcategories?.workshop_task_categories?.name
    )
  );
}
