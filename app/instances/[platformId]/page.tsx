import InstancesView from "../instances-view";

type PlatformInstancesPageProps = {
  params: Promise<{ platformId: string }>;
};

export default async function PlatformInstancesPage({ params }: PlatformInstancesPageProps) {
  const { platformId } = await params;

  return <InstancesView platformId={platformId} />;
}
