import Shell from "./Shell";
import ArchiveView from "./ArchiveView";

export default function Home() {
  return (
    <Shell>
      <ArchiveView
        kind="viewonce"
        title="ViewOnce"
        description="Foto, video, dan audio sekali lihat yang dibalas ke bot."
        emptyTitle="No archived media found."
      />
    </Shell>
  );
}
