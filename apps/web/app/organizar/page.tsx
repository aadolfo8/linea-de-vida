import { redirect } from 'next/navigation';
import { legacyOrganizarHref } from '../../lib/ordering/location';

type SearchParams = Record<string, string | string[] | undefined>;

/** The old address keeps working: it lands on Ordenar with the same source and folder. */
export default async function LegacyOrganizarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  redirect(legacyOrganizarHref(await searchParams));
}
