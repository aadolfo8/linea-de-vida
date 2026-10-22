import { redirect } from 'next/navigation';
import { legacySettingsHref } from '../../lib/ordering/location';

type SearchParams = Record<string, string | string[] | undefined>;

/** The old address keeps working, and so does the Drive consent that returns to it. */
export default async function LegacySettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  redirect(legacySettingsHref(await searchParams));
}
