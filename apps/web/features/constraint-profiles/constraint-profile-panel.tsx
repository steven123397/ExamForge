"use client";

import { Check, GitBranch, LoaderCircle, Plus, Save, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ConstraintProfile,
  ConstraintProfileRecord,
} from "@examforge/shared";
import { apiClient } from "../../lib/api-client";

export interface ConstraintProfileForm {
  hardRules: string;
  softWeights: Record<string, string>;
  timeLimitSeconds: string;
}

export function ConstraintProfilePanel({
  profiles,
  isAdmin,
  selectedVersionId,
  loading,
  onSelectVersion,
  onChanged,
}: {
  profiles: ConstraintProfileRecord[];
  isAdmin: boolean;
  selectedVersionId: string;
  loading: boolean;
  onSelectVersion(versionId: string): void;
  onChanged(): Promise<unknown>;
}) {
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [editingNew, setEditingNew] = useState(false);
  const [name, setName] = useState("");
  const [form, setForm] = useState<ConstraintProfileForm>(emptyProfileForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedVersionProfile = profiles.find((profile) => profile.versions.some((version) => (
    version.id === selectedVersionId
  )));
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId)
    ?? selectedVersionProfile
    ?? profiles[0]
    ?? null;
  const currentVersion = selectedProfile?.versions.find((version) => (
    version.id === selectedVersionId
  )) ?? selectedProfile?.versions.find((version) => (
    version.id === selectedProfile.currentVersionId
  )) ?? null;

  useEffect(() => {
    if (selectedVersionProfile && selectedVersionProfile.id !== selectedProfileId) {
      setSelectedProfileId(selectedVersionProfile.id);
    } else if (!selectedProfileId && profiles[0]) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId, selectedVersionProfile?.id]);

  useEffect(() => {
    if (!editingNew && selectedProfile && currentVersion) {
      setName(selectedProfile.name);
      setForm(profileFormFromConfig(currentVersion.config));
    }
  }, [currentVersion?.id, editingNew, selectedProfile?.id, selectedProfile?.name]);

  const activeVersions = useMemo(() => profiles
    .filter((profile) => profile.status === "active")
    .flatMap((profile) => profile.versions.map((version) => ({ profile, version }))), [profiles]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const config = profileConfigFromForm(form);
      if (editingNew) {
        const created = await apiClient.createConstraintProfile(name, config);
        setSelectedProfileId(created.profile.id);
        onSelectVersion(created.profile.currentVersionId);
        setEditingNew(false);
      } else if (selectedProfile) {
        const updated = await apiClient.createConstraintProfileVersion(
          selectedProfile.id,
          selectedProfile.currentVersionId,
          config,
        );
        onSelectVersion(updated.profile.currentVersionId);
      }
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "策略保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(profile: ConstraintProfileRecord) {
    const next = profile.status === "active" ? "disabled" : "active";
    if (next === "disabled" && !window.confirm(`确认禁用策略“${profile.name}”？`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient.setConstraintProfileStatus(profile.id, next);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "策略状态更新失败");
    } finally {
      setSaving(false);
    }
  }

  async function setDefault(profile: ConstraintProfileRecord) {
    if (!confirmDefaultProfileChange(profile.name)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiClient.setDefaultConstraintProfile(profile.id);
      onSelectVersion(profile.currentVersionId);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "默认策略切换失败");
    } finally {
      setSaving(false);
    }
  }

  function startCreate() {
    setEditingNew(true);
    setName("");
    setForm(profileFormFromConfig(currentVersion?.config ?? {
      hard_rules: [],
      soft_weights: {},
      time_limit_seconds: 10,
    }));
  }

  return (
    <div className="strategy-workspace" data-testid="constraint-profile-panel">
      <div className="strategy-rail">
        <div className="strategy-launcher">
          <label htmlFor="schedule-strategy-version">排考策略版本</label>
          <select
            id="schedule-strategy-version"
            value={selectedVersionId}
            onChange={(event) => onSelectVersion(event.target.value)}
            disabled={loading || activeVersions.length === 0}
          >
            {activeVersions.map(({ profile, version }) => (
              <option value={version.id} key={version.id}>
                {profile.name} · v{version.versionNumber}
              </option>
            ))}
          </select>
          <span>{activeVersions.length} 个可选版本</span>
        </div>
        <ul className="strategy-list">
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                className={profile.id === selectedProfile?.id ? "strategy-row active" : "strategy-row"}
                onClick={() => {
                  setEditingNew(false);
                  setSelectedProfileId(profile.id);
                  onSelectVersion(profile.currentVersionId);
                }}
              >
                <span>
                  <strong>{profile.name}</strong>
                  <small>v{profile.versions.at(-1)?.versionNumber ?? 1} · {profile.status === "active" ? "启用" : "停用"}</small>
                </span>
                {profile.isDefault ? <Star size={15} fill="currentColor" aria-label="默认策略" /> : null}
              </button>
            </li>
          ))}
        </ul>
        {isAdmin ? (
          <button type="button" className="secondary-button" onClick={startCreate}>
            <Plus size={16} />
            新建策略
          </button>
        ) : null}
      </div>

      <div className="strategy-editor">
        <div className="strategy-editor-head">
          <div>
            <span>{editingNew ? "New profile" : `Version ${currentVersion?.versionNumber ?? "-"}`}</span>
            <h3>{editingNew ? "创建约束策略" : selectedProfile?.name ?? "暂无策略"}</h3>
          </div>
          {!editingNew && selectedProfile && isAdmin ? (
            <div className="strategy-actions">
              <label className="switch-control">
                <input
                  type="checkbox"
                  checked={selectedProfile.status === "active"}
                  onChange={() => void toggleStatus(selectedProfile)}
                  disabled={saving || selectedProfile.isDefault}
                />
                <span>{selectedProfile.status === "active" ? "启用" : "停用"}</span>
              </label>
              <button
                type="button"
                className="mini-button"
                disabled={saving || selectedProfile.isDefault || selectedProfile.status !== "active"}
                onClick={() => void setDefault(selectedProfile)}
              >
                {selectedProfile.isDefault ? <Check size={14} /> : <Star size={14} />}
                {selectedProfile.isDefault ? "当前默认" : "设为默认"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="strategy-meta">
          <span>当前版本 <strong>{selectedProfile?.currentVersionId ?? "--"}</strong></span>
          <span>摘要 <strong>{currentVersion?.digest.slice(0, 12) ?? "--"}</strong></span>
          <span>历史版本 <strong>{selectedProfile?.versions.length ?? 0}</strong></span>
        </div>

        <div className="strategy-form">
          {editingNew ? (
            <label className="strategy-name-field">
              <span>策略名称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} disabled={!isAdmin} />
            </label>
          ) : null}
          <label className="strategy-hard-rules">
            <span>硬约束规则</span>
            <textarea
              value={form.hardRules}
              onChange={(event) => setForm((current) => ({ ...current, hardRules: event.target.value }))}
              disabled={!isAdmin}
            />
          </label>
          <div className="strategy-weight-grid">
            {Object.entries(form.softWeights).map(([rule, value]) => (
              <label key={rule}>
                <span>{rule}</span>
                <input
                  type="number"
                  min="0"
                  max="1000"
                  step="1"
                  value={value}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    softWeights: { ...current.softWeights, [rule]: event.target.value },
                  }))}
                  disabled={!isAdmin}
                />
              </label>
            ))}
          </div>
          <label className="strategy-time-limit">
            <span>求解时限（秒）</span>
            <input
              type="number"
              min="1"
              value={form.timeLimitSeconds}
              onChange={(event) => setForm((current) => ({
                ...current,
                timeLimitSeconds: event.target.value,
              }))}
              disabled={!isAdmin}
            />
          </label>
        </div>
        {error ? <p className="strategy-error" role="alert">{error}</p> : null}
        {isAdmin ? (
          <div className="strategy-save-row">
            <button type="button" className="primary-button" onClick={() => void save()} disabled={saving || !name.trim()}>
              {saving ? <LoaderCircle size={16} className="spin-icon" /> : editingNew ? <Save size={16} /> : <GitBranch size={16} />}
              {editingNew ? "创建 v1" : "保存为新版本"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function confirmDefaultProfileChange(
  profileName: string,
  confirm: (message: string) => boolean = (message) => window.confirm(message),
) {
  return confirm(`确认将策略“${profileName}”设为默认？后续新任务将使用其当前版本。`);
}

export function profileConfigFromForm(form: ConstraintProfileForm): ConstraintProfile {
  const hardRules = form.hardRules.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
  const softWeights = Object.fromEntries(Object.entries(form.softWeights).map(([rule, value]) => {
    const weight = Number(value);
    if (!Number.isInteger(weight) || weight < 0 || weight > 1000) {
      throw new Error(`权重 ${rule} 必须是 0 到 1000 的整数`);
    }
    return [rule, weight];
  }));
  const timeLimit = Number(form.timeLimitSeconds);
  if (!Number.isInteger(timeLimit) || timeLimit <= 0) {
    throw new Error("求解时限必须是正整数");
  }
  return {
    hard_rules: hardRules,
    soft_weights: softWeights,
    time_limit_seconds: timeLimit,
  };
}

function profileFormFromConfig(config: ConstraintProfile): ConstraintProfileForm {
  return {
    hardRules: config.hard_rules.join("\n"),
    softWeights: Object.fromEntries(Object.entries(config.soft_weights).map(([rule, weight]) => (
      [rule, String(weight)]
    ))),
    timeLimitSeconds: String(config.time_limit_seconds),
  };
}

function emptyProfileForm(): ConstraintProfileForm {
  return { hardRules: "", softWeights: {}, timeLimitSeconds: "10" };
}
