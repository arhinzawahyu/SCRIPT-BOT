import Shell from "../Shell";
import ArchiveView from "../ArchiveView";

export default function DihapusPage() {
  return (
    <Shell>
      <ArchiveView
        kind="delete"
        title="Pesan Dihapus"
        description="Log teks atau caption yang dihapus pengirim sebelum sempat dibaca."
        emptyTitle="No deleted messages."
      />
    </Shell>
  );
}
