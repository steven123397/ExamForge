import { Check, Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReferenceDataResponse, ReferenceRecord } from "@examforge/shared";
import { apiClient } from "../../lib/api-client";
import { ConfirmationDialog } from "../../components/shared/confirmation-dialog";
import {
  type EditableResource,
  type FormState,
  formToPayload,
  getEditableRecords,
  omitId,
  recordTitle,
  recordToForm,
  referenceForms,
  sampleImportText,
} from "./reference-data-forms";

export function ReferenceDataManager({
  referenceData,
  onRefresh,
  onError,
}: {
  referenceData: ReferenceDataResponse | null;
  onRefresh(): Promise<void>;
  onError(message: string | null): void;
}) {
  const [resource, setResource] = useState<EditableResource>("courses");
  const [mode, setMode] = useState<"create" | "edit">("edit");
  const [form, setForm] = useState<FormState>(referenceForms.courses.defaults);
  const [importText, setImportText] = useState(() => sampleImportText("courses"));
  const [saving, setSaving] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const config = referenceForms[resource];
  const records = getEditableRecords(referenceData, resource);
  const selectedId = form.id;

  useEffect(() => {
    const nextRecords = getEditableRecords(referenceData, resource);
    const first = nextRecords[0];
    setMode(first ? "edit" : "create");
    setForm(first ? recordToForm(resource, first) : referenceForms[resource].defaults);
    setImportText(sampleImportText(resource));
  }, [referenceData, resource]);

  function selectResource(nextResource: EditableResource) {
    setResource(nextResource);
  }

  function selectRecord(record: ReferenceRecord) {
    setMode("edit");
    setForm(recordToForm(resource, record));
  }

  function createDraft() {
    setMode("create");
    setForm(referenceForms[resource].defaults);
  }

  async function saveRecord() {
    setSaving(true);
    onError(null);
    try {
      const payload = formToPayload(resource, form);
      const result = mode === "create"
        ? await apiClient.createReferenceRecord(resource, payload)
        : await apiClient.updateReferenceRecord(resource, form.id, omitId(payload));
      setMode("edit");
      setForm(recordToForm(resource, result.record));
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "基础数据保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (mode !== "edit" || !form.id) {
      return;
    }
    setSaving(true);
    onError(null);
    try {
      await apiClient.deleteReferenceRecord(resource, form.id);
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "基础数据删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function importRecords() {
    setSaving(true);
    onError(null);
    try {
      const parsed = JSON.parse(importText) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("导入内容必须是 JSON 数组");
      }
      await apiClient.importReferenceRecords(resource, parsed);
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "基础数据导入失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="reference-manager" data-testid="reference-data-manager">
      <div className="resource-tabs">
        {(Object.keys(referenceForms) as EditableResource[]).map((item) => (
          <button
            key={item}
            type="button"
            className={item === resource ? "active" : ""}
            onClick={() => selectResource(item)}
          >
            {referenceForms[item].label}
          </button>
        ))}
      </div>

      <div className="reference-layout">
        <div className="record-list">
          <button type="button" className="record-create" onClick={createDraft}>
            <Plus size={16} />
            <span>新增{config.label}</span>
          </button>
          {records.map((record) => (
            <button
              key={record.id}
              type="button"
              className={mode === "edit" && selectedId === record.id ? "record-row active" : "record-row"}
              onClick={() => selectRecord(record)}
            >
              <span>{recordTitle(resource, record)}</span>
              <strong>{record.id}</strong>
            </button>
          ))}
        </div>

        <div className="record-editor">
          <div className="editor-title">
            <div>
              <span>{mode === "create" ? "Create" : "Update"}</span>
              <strong>{config.label}</strong>
            </div>
            <button type="button" className="secondary-button" onClick={saveRecord} disabled={saving}>
              {saving ? <Check size={16} /> : <Save size={16} />}
              {saving ? "保存中" : "保存"}
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={() => setDeleteConfirmationOpen(true)}
              disabled={saving || mode !== "edit"}
            >
              删除
            </button>
          </div>

          <div className="form-grid">
            {config.fields.map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={form[key] ?? ""}
                  disabled={mode === "edit" && key === "id"}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="import-panel">
        <div className="import-title">
          <div>
            <span>Bulk Import</span>
            <strong>{config.label} JSON 导入</strong>
          </div>
          <button type="button" className="secondary-button" onClick={importRecords} disabled={saving}>
            导入覆盖
          </button>
        </div>
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          spellCheck={false}
        />
      </div>
      {deleteConfirmationOpen && mode === "edit" && form.id ? (
        <ConfirmationDialog
          title="确认删除基础数据"
          target={form.id}
          description={`删除${config.label}可能影响排考引用；存在关联数据时服务端会拒绝该操作。`}
          confirmLabel="确认删除"
          onConfirm={deleteRecord}
          onCancel={() => setDeleteConfirmationOpen(false)}
        />
      ) : null}
    </div>
  );
}
