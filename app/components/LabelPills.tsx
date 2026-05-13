import { PD_LABEL_COLORS } from '@/lib/pipedrive/client';
import { type LabelInfo, type LabelsByOrgId } from '@/lib/pipedrive/all-labels';

/** Inline label badges for a Pipedrive org. Renders an em dash when no labels. */
export function LabelPills({ labels }: { labels: LabelInfo[] }) {
  if (!labels || labels.length === 0) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((l) => {
        const hex = PD_LABEL_COLORS[l.color] ?? '#94a3b8';
        return (
          <span
            key={l.id}
            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{ background: `${hex}26`, color: hex }}
          >
            {l.name}
          </span>
        );
      })}
    </div>
  );
}

export function LabelsForOrg({
  orgId,
  labelsByOrgId,
}: {
  orgId: number;
  labelsByOrgId: LabelsByOrgId;
}) {
  const labels = labelsByOrgId[orgId] ?? [];
  return <LabelPills labels={labels} />;
}
