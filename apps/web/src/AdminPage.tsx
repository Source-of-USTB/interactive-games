import { useEffect, useState } from "react";
import type { GameMode } from "@codegame/game-core";
import { ConnectionPill, PHASE_LABELS, useClock } from "./game-ui.js";
import { useRealtime } from "./realtime.js";

interface MapSummary {
  id: string;
  name: string;
  chapter: number;
  difficulty: number;
  modes: GameMode[];
}

interface Health {
  status: string;
  players: number;
  websocketClients: number;
  screenConnected: boolean;
  screenLastAckAt: number;
  uptimeSeconds: number;
  pausedForScreen: boolean;
  publicOrigin: string;
  localOrigin: string;
}

export function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem("codegame.admin.token") ?? "");
  const [draftToken, setDraftToken] = useState(token);
  const [verifying, setVerifying] = useState(false);
  const [loginError, setLoginError] = useState<string>();
  const realtime = useRealtime({ role: "admin", token, enabled: Boolean(token) });
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [selectedMap, setSelectedMap] = useState("");
  const [selectedMode, setSelectedMode] = useState<GameMode>("COCODE");
  const [timingSeconds, setTimingSeconds] = useState<Record<string, number>>({
    joinMs: 10,
    briefingMs: 10,
    voteMs: 10,
    revealMs: 3,
    compileMs: 3,
    predictMs: 10,
    debugSelectMs: 10,
    debugPatchMs: 10,
    emergencyPatchMs: 10,
    resultMs: 10,
    resetMs: 3,
  });
  const [health, setHealth] = useState<Health>();
  const [message, setMessage] = useState<string>();
  const [qrMode, setQrMode] = useState<"public" | "local" | "hidden">("public");
  const [masterVolume, setMasterVolume] = useState(80);
  const [effectsVolume, setEffectsVolume] = useState(80);
  const [showVoteTrends, setShowVoteTrends] = useState(true);
  const [demoMode, setDemoMode] = useState(false);
  const now = useClock(1000);

  const clearAdminToken = (): void => {
    localStorage.removeItem("codegame.admin.token");
    setToken("");
    setDraftToken("");
  };

  const enter = async (): Promise<void> => {
    setVerifying(true);
    try {
      const response = await fetch("/api/maps", { headers: { Authorization: `Bearer ${draftToken}` } });
      if (response.status === 401 || response.status === 403) throw new Error("管理密钥无效");
      if (!response.ok) throw new Error("无法连接管理服务");
      localStorage.setItem("codegame.admin.token", draftToken);
      setToken(draftToken);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "验证失败");
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (realtime.authInvalid) clearAdminToken();
  }, [realtime.authInvalid]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/maps", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401) {
          clearAdminToken();
          throw new Error("管理密钥无效");
        }
        if (!response.ok) throw new Error("地图读取失败");
        return response.json() as Promise<MapSummary[]>;
      })
      .then((value) => {
        setMaps(value);
        setSelectedMap(value[0]?.id ?? "");
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "地图读取失败"));
  }, [token]);

  useEffect(() => {
    const poll = (): void => {
      fetch("/api/health").then((response) => response.json() as Promise<Health>).then(setHealth).catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 3_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!realtime.settings) return;
    setQrMode(realtime.settings.qrMode);
    setMasterVolume(Math.round(realtime.settings.masterVolume * 100));
    setEffectsVolume(Math.round(realtime.settings.effectsVolume * 100));
    setShowVoteTrends(realtime.settings.showVoteTrends);
    setDemoMode(realtime.settings.demoMode);
  }, [realtime.settings]);

  const command = async (name: string, extra: Record<string, unknown> = {}): Promise<void> => {
    try {
      await realtime.send({ type: "admin.command", command: name, ...extra });
      setMessage("操作已执行");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  };

  const exportStats = async (): Promise<void> => {
    try {
      const response = await fetch("/api/stats/export.csv", { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("导出失败");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `codegame-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("匿名聚合统计已导出");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "导出失败");
    }
  };

  if (!token) {
    return (
      <main className="admin-login">
        <section className="admin-login-card">
          <p className="eyebrow">本地管理控制台</p>
          <h1>输入现场管理密钥</h1>
          <p>管理页面不会与玩家二维码共享入口。</p>
          <input type="password" value={draftToken} onChange={(event) => {
            setDraftToken(event.target.value);
            setLoginError(undefined);
          }} placeholder="ADMIN_TOKEN" autoFocus />
          {loginError && <p className="admin-login-error">{loginError}</p>}
          <button className="primary-button" type="button" disabled={verifying || draftToken.length === 0} onClick={() => void enter()}>
            {verifying ? "验证中…" : "进入控制台"}
          </button>
        </section>
      </main>
    );
  }

  const state = realtime.state;
  const correctedNow = now + realtime.clockOffset;
  const compatibleMaps = maps.filter((map) => map.modes.includes(selectedMode));

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p className="eyebrow">全场一起写代码</p><h1>现场控制台</h1></div>
        <ConnectionPill status={realtime.status} />
      </header>

      <section className="health-grid">
        <HealthCard label="游戏阶段" value={state ? PHASE_LABELS[state.phase] : "读取中"} tone="blue" />
        <HealthCard label="在线玩家" value={String(state?.connectedPlayers ?? health?.players ?? 0)} tone="green" />
        <HealthCard label="大屏状态" value={health?.screenConnected ? "已连接" : health?.pausedForScreen ? "掉线保护" : "未连接"} tone={health?.screenConnected ? "green" : "red"} />
        <HealthCard label="服务运行" value={health ? `${Math.floor(health.uptimeSeconds / 60)} 分钟` : "读取中"} tone="blue" />
      </section>

      <div className="admin-columns">
        <section className="admin-panel">
          <div className="panel-heading"><div><p className="eyebrow">当前轮次</p><h2>{state?.map.name ?? "尚未加载"}</h2></div><span className="room-badge">{state?.roomId ?? "MAIN"}</span></div>
          {state && <dl className="state-list">
            <div><dt>模式</dt><dd>{modeLabel(state.mode)}</dd></div>
            <div><dt>轮次</dt><dd>{state.roundId.slice(0, 8)}</dd></div>
            <div><dt>协作能量</dt><dd>{state.collaborationEnergy} / 3</dd></div>
            <div><dt>调试次数</dt><dd>{state.debugAttempts}</dd></div>
            <div><dt>剩余时间</dt><dd>{Math.max(0, Math.ceil((state.phaseEndsAt - correctedNow) / 1000))} 秒</dd></div>
          </dl>}
          <div className="admin-button-grid">
            <button type="button" className="admin-button admin-button--warn" onClick={() => void command("pause")}>暂停</button>
            <button type="button" className="admin-button" onClick={() => void command("resume")}>继续</button>
            <button type="button" className="admin-button" onClick={() => void command("skip")}>跳过阶段</button>
            <button type="button" className="admin-button admin-button--danger" onClick={() => {
              if (window.confirm("确认立即重置当前轮次？已提交内容会被清除。")) void command("reset");
            }}>紧急重置</button>
          </div>
        </section>

        <section className="admin-panel">
          <div className="panel-heading"><div><p className="eyebrow">选择内容</p><h2>启动指定关卡</h2></div></div>
          <label className="field-label">游戏模式
            <select value={selectedMode} onChange={(event) => {
              const next = event.target.value as GameMode;
              setSelectedMode(next);
              setSelectedMap(maps.find((map) => map.modes.includes(next))?.id ?? "");
            }}>
              <option value="COCODE">全场共编</option>
              <option value="BUG_CLINIC">Bug 急诊室</option>
              <option value="LOGIC_LAB">逻辑实验室</option>
            </select>
          </label>
          <label className="field-label">关卡
            <select value={selectedMap} onChange={(event) => setSelectedMap(event.target.value)}>
              {compatibleMaps.map((map) => <option key={map.id} value={map.id}>第 {map.chapter} 章 · {map.name} · 难度 {map.difficulty}</option>)}
            </select>
          </label>
          <button className="primary-button" type="button" onClick={() => void command("start", { mode: selectedMode, mapId: selectedMap })}>启动指定关卡</button>
          <button className="secondary-button" type="button" onClick={() => void command("core-battle")}>启动整点核心战</button>
        </section>

        <section className="admin-panel">
          <div className="panel-heading"><div><p className="eyebrow">节奏设置</p><h2>现场时间参数</h2></div></div>
          <div className="timing-grid">
            {TIMING_FIELDS.map(([key, label]) => (
              <label key={key} className="timing-row">
                <span className="timing-name">{label}</span>
                <input type="range" min="1" max="30" value={timingSeconds[key] ?? 10} onChange={(event) => setTimingSeconds({ ...timingSeconds, [key]: Number(event.target.value) })} />
                <b>{timingSeconds[key] ?? 10}s</b>
              </label>
            ))}
          </div>
          <button className="primary-button" type="button" onClick={() => {
            const payload = Object.fromEntries(Object.entries(timingSeconds).map(([key, seconds]) => [key, seconds * 1000]));
            void command("timings", payload);
          }}>应用时间设置</button>
        </section>

        <section className="admin-panel admin-panel--stats">
          <div className="panel-heading"><div><p className="eyebrow">今日聚合</p><h2>科技城进度</h2></div></div>
          <div className="stat-grid">
            <strong>{realtime.daily?.participantSessions ?? 0}<small>参与人次</small></strong>
            <strong>{realtime.daily?.commandsSubmitted ?? 0}<small>提交指令</small></strong>
            <strong>{realtime.daily?.bugsFixed ?? 0}<small>修复 Bug</small></strong>
            <strong>{realtime.daily?.successfulDeliveries ?? 0}<small>成功送达</small></strong>
          </div>
          <div className="city-progress"><span style={{ width: `${Math.min(100, (realtime.daily?.cityEnergy ?? 0) % 101)}%` }} /></div>
          <button className="secondary-button" type="button" onClick={() => void exportStats()}>导出匿名轮次 CSV</button>
        </section>

        <section className="admin-panel">
          <div className="panel-heading"><div><p className="eyebrow">展示与网络</p><h2>大屏运行策略</h2></div></div>
          <label className="field-label">二维码入口
            <select value={qrMode} onChange={(event) => setQrMode(event.target.value as typeof qrMode)}>
              <option value="public">公网穿透（主入口）</option>
              <option value="local">本地 Wi-Fi（备用）</option>
              <option value="hidden">隐藏（只演示）</option>
            </select>
          </label>
          <label className="field-label">主音量：{masterVolume}%
            <input type="range" min="0" max="100" value={masterVolume} onChange={(event) => setMasterVolume(Number(event.target.value))} />
          </label>
          <label className="field-label">效果音：{effectsVolume}%
            <input type="range" min="0" max="100" value={effectsVolume} onChange={(event) => setEffectsVolume(Number(event.target.value))} />
          </label>
          <label className="toggle-row"><input type="checkbox" checked={showVoteTrends} onChange={(event) => setShowVoteTrends(event.target.checked)} /><span>投票后 40% 显示趋势柱</span></label>
          <label className="toggle-row"><input type="checkbox" checked={demoMode} onChange={(event) => setDemoMode(event.target.checked)} /><span>强制无服务演示模式</span></label>
          <button className="primary-button" type="button" onClick={() => void command("display", {
            qrMode,
            masterVolume: masterVolume / 100,
            effectsVolume: effectsVolume / 100,
            showVoteTrends,
            demoMode,
          })}>应用大屏设置</button>
          <p className="endpoint-note">公网：{health?.publicOrigin ?? "未配置"}<br />本地：{health?.localOrigin ?? "未配置"}</p>
        </section>
      </div>

      {message && <div className="toast" onClick={() => setMessage(undefined)}>{message}</div>}
      <button type="button" className="logout-button" onClick={clearAdminToken}>退出管理端</button>
    </main>
  );
}

function HealthCard({ label, value, tone }: { label: string; value: string; tone: "blue" | "green" | "red" }) {
  return <div className={`health-card health-card--${tone}`}><span>{label}</span><strong>{value}</strong></div>;
}

function modeLabel(mode: GameMode): string {
  return { COCODE: "全场共编", BUG_CLINIC: "Bug 急诊室", LOGIC_LAB: "逻辑实验室", CORE_BATTLE: "整点核心战" }[mode];
}

const TIMING_FIELDS: Array<[string, string]> = [
  ["joinMs", "集结等待"],
  ["briefingMs", "任务预览"],
  ["voteMs", "每步投票"],
  ["revealMs", "亮票展示"],
  ["compileMs", "编译过程"],
  ["predictMs", "结果预测"],
  ["debugSelectMs", "定位 Bug"],
  ["debugPatchMs", "提交补丁"],
  ["emergencyPatchMs", "紧急补丁"],
  ["resultMs", "结算展示"],
  ["resetMs", "切换关卡"],
];
