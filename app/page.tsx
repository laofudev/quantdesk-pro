/**
 * 应用入口（Server Component）
 *
 * 职责：判断当前会话是否已配置扶摇 API Key
 *   - 未配置 → 渲染 Onboarding 接入引导
 *   - 已配置 → 渲染 Workbench 主工作台
 *
 * 凭据只以掩码形式下发给前端，明文永不离开服务端。
 */
import { getSessionId } from "@/lib/session";
import { credentialStatus } from "@/lib/credentials";
import Onboarding from "@/components/Onboarding";
import Workbench from "@/components/Workbench";
import type { CredentialInfo } from "@/components/ApiKeyModal";

export const dynamic = "force-dynamic";

export default async function Home() {
  let credential: CredentialInfo | null = null;

  try {
    const sid = await getSessionId();
    const status = await credentialStatus(sid);
    if (status) {
      credential = {
        configured: true,
        masked: status.masked,
        createdAt: status.createdAt,
        lastUsedAt: status.lastUsedAt,
      };
    }
  } catch {
    credential = null;
  }

  if (!credential?.configured) {
    return <Onboarding />;
  }

  return <Workbench initialCredential={credential} />;
}
