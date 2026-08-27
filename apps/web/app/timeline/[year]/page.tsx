import { TimelineRoute } from '../../components/TimelineRoute';

export default async function TimelineYearPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { view } = await searchParams;
  return <TimelineRoute view={view === 'editorial' ? 'editorial' : 'immersive'} />;
}
