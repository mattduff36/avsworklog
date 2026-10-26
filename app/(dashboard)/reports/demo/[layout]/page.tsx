import { notFound } from 'next/navigation';
import { ReportLayoutDemo } from '@/components/reports/demo/ReportLayoutDemo';

export default async function ReportDemoPage({ params }: { params: Promise<{ layout: string }> }) {
  const { layout } = await params;
  if (layout !== 'library' && layout !== 'overview' && layout !== 'guided') notFound();
  return <ReportLayoutDemo layout={layout} />;
}
