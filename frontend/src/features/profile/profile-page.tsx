import { Clapperboard, ImageIcon, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "../../components/ui/button";
import { AccountMark, useSession } from "../auth";
import { PublicWorkGallery } from "./public-work-gallery";

type WorkTab = "image" | "video";
function WorkTabs({ tab, setTab }: { tab: WorkTab; setTab: (tab: WorkTab) => void }) {
  return <div aria-label="作品类型" className="generation-type profile-tabs" role="tablist">
    {(["image", "video"] as const).map(kind => <button type="button" key={kind} role="tab" aria-selected={tab === kind} className={tab === kind ? "active" : ""} onClick={() => setTab(kind)}>{kind === "image" ? <ImageIcon size={16} /> : <Clapperboard size={16} />}{kind === "image" ? "图片" : "视频"}</button>)}
  </div>;
}
export function ProfilePage({ projectId }: { projectId: string }) {
  const session = useSession();
  const [tab, setTab] = useState<WorkTab>("image");
  const email = session.data?.email ?? "";
  return <main className="workspace-content profile-page">
    <section className="profile-identity"><AccountMark email={email} size="lg" /><div><p className="workspace-eyebrow">PROFILE</p><h1>{email}</h1><p>你的公开作品集</p></div></section>
    <div className="profile-works-heading"><WorkTabs tab={tab} setTab={setTab} /><div className="flex gap-2"><Button asChild variant="outline"><Link to={`/projects/${projectId}/assets`}>管理作品</Link></Button>{session.data && <Button asChild variant="ghost"><Link to={`/u/${session.data.id}`} target="_blank"><ExternalLink size={16} />公开主页</Link></Button>}</div></div>
    {session.data && <PublicWorkGallery key={`${session.data.id}-${tab}`} userId={session.data.id} kind={tab} />}
  </main>;
}
export function PublicProfilePage() {
  const { userId = "" } = useParams();
  const [tab, setTab] = useState<WorkTab>("image");
  return <main className="public-profile-page"><header><Link to="/">LUMI</Link><h1>个人作品集</h1><p>公开分享的灵感与创作</p></header><div className="profile-works-heading"><WorkTabs tab={tab} setTab={setTab} /></div><PublicWorkGallery key={`${userId}-${tab}`} userId={userId} kind={tab} /></main>;
}
