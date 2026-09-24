import Shell from "./Shell";
import ArchiveView from "./ArchiveView";

export default function Home() {
  return (
    <Shell>
      <ArchiveView
        kind="viewonce"
        title="ViewOnce"
        description="Foto, video, dan audio sekali lihat. Tersimpan private; WhatsApp hanya menerima notifikasi."
        emptyTitle="No archived media found."
      />
    </Shell>
  );
}
