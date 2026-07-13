import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queryKeys } from "../lib/query-keys.js";
import { dashboardQueryOptions } from "../features/dashboard/queries.js";
import {
  readReferencePageState,
  referenceMutationInvalidationKeys,
  updateReferencePageSearch,
} from "../features/reference-data/page-model.js";
import { referenceDataQueryOptions } from "../features/reference-data/queries.js";

describe("overview and reference-data page models", () => {
  it("binds dashboard and reference data to independent query options", () => {
    assert.deepEqual(dashboardQueryOptions().queryKey, queryKeys.dashboard);
    assert.deepEqual(referenceDataQueryOptions().queryKey, queryKeys.referenceData);
  });

  it("normalizes resource tabs and selected records from shareable URL state", () => {
    assert.deepEqual(
      readReferencePageState(new URLSearchParams("resource=teachers&id=t-zhang")),
      { resource: "teachers", selectedId: "t-zhang" },
    );
    assert.deepEqual(
      readReferencePageState(new URLSearchParams("resource=unknown&id=")),
      { resource: "courses", selectedId: null },
    );
    assert.equal(
      updateReferencePageSearch(
        new URLSearchParams("resource=courses&id=c-old&trace=keep"),
        { resource: "student-groups", selectedId: "g-cs-2301" },
      ),
      "resource=student-groups&id=g-cs-2301&trace=keep",
    );
  });

  it("invalidates only the reference collection and dashboard summary after mutations", () => {
    assert.deepEqual(referenceMutationInvalidationKeys(), [
      queryKeys.referenceData,
      queryKeys.dashboard,
    ]);
  });
});
