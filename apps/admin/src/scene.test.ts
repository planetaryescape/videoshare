import { Option } from "effect";
import { Dialog } from "@foldkit/ui";
import { Scene } from "foldkit";
import { describe, test } from "vitest";
import {
  DeleteAssetConfirmation,
  DeleteProjectConfirmation,
  EditAsset,
  ProjectEdit,
  ProjectList,
  ProjectsFailed,
  ProjectMembershipSaving,
  ProjectOperationFailed,
  ProjectOperationPending,
  initialModel,
  type Chapter,
  type Asset,
  type ProjectDetail,
} from "./model";
import { update } from "./update";
import { view } from "./view";

const video: Asset = {
  id: "video-1",
  slug: "fixture-video",
  kind: "video",
  title: "Fixture Asset",
  description: "Fixture description",
  posterKey: null,
  mediaKey: "assets/video-1/master.m3u8",
  durationSec: 125,
  width: null,
  height: null,
  projectId: null,
  sortOrder: null,
  createdAt: 1_750_000_000_000,
  publishedAt: null,
  updatedAt: 1_750_000_001_000,
};

const image: Asset = {
  ...video,
  id: "image-1",
  slug: "fixture-image",
  kind: "image",
  title: "Fixture Image",
  mediaKey: "media/image-1/original.png",
  durationSec: 0,
  width: 640,
  height: 480,
};

const chapter: Chapter = {
  id: "chapter-1",
  assetId: video.id,
  title: "Introduction",
  startSec: 0,
  sortOrder: 0,
};

const projectDetail = (overrides: Partial<ProjectDetail> = {}): ProjectDetail => ({
  project: {
    id: "project-1",
    slug: "client-project",
    title: "Client project",
    description: null,
    createdAt: 1_750_000_000_000,
    publishedAt: null,
    updatedAt: null,
  },
  assets: [
    {
      ...video,
      id: "project-member-1",
      title: "Project member",
      projectId: "project-1",
      sortOrder: 0,
    },
  ],
  ...overrides,
});

describe("admin scenes", () => {
  test("renders the project list by default", () => {
    Scene.scene(
      { update, view },
      Scene.with(initialModel()),
      Scene.expect(Scene.role("heading", { name: "Projects", level: 1 })).toExist(),
      Scene.expect(Scene.text("Loading projects…")).toExist(),
      Scene.expect(Scene.role("button", { name: "New Project" })).toExist(),
    );
  });

  test("renders project navigation and project list", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectList(),
        projectsLoadState: { _tag: "ProjectsLoaded" },
        projects: [
          {
            id: "project-1",
            slug: "project",
            title: "Client project",
            description: null,
            memberCount: 1,
            createdAt: 1,
            publishedAt: null,
            updatedAt: null,
          },
        ],
      }),
      Scene.expect(Scene.role("heading", { name: "Projects", level: 1 })).toExist(),
      Scene.expect(Scene.role("button", { name: "New Project" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Client project" })).toExist(),
    );
  });

  test("shows a project load error and retry instead of an unfiled-only selector", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, projectId: "project-1", sortOrder: 0 }),
        projectsLoadState: ProjectsFailed(),
      }),
      Scene.expect(Scene.text("Could not load projects.")).toExist(),
      Scene.expect(Scene.role("button", { name: "Retry" })).toExist(),
      Scene.expect(Scene.role("combobox")).not.toExist(),
    );
  });

  test("renders an uploaded draft", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: { _tag: "EditAsset", assetId: video.id },
        assets: [video],
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
      }),
      Scene.expect(Scene.role("heading", { name: video.title, level: 1 })).toExist(),
      Scene.expect(Scene.role("heading", { name: "Review playback", level: 2 })).toExist(),
      Scene.expect(Scene.role("button", { name: "Add at playhead" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Publish" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Copy link" })).toExist(),
    );
  });

  test("renders image-specific review and upload copy", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: { _tag: "EditAsset", assetId: image.id },
        assets: [image],
        editAsset: Option.some(image),
        editTitle: image.title,
        editDescription: image.description ?? "",
      }),
      Scene.expect(Scene.role("heading", { name: "Review image", level: 2 })).toExist(),
      Scene.expect(Scene.text("Review the image before publishing.")).toExist(),
      Scene.expect(Scene.role("button", { name: "Add at playhead" })).not.toExist(),
    );

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: image.id }),
        editAsset: Option.some({ ...image, mediaKey: "" }),
        editTitle: image.title,
        editDescription: image.description ?? "",
        isUploading: true,
        selectedFile: Option.some(new File(["image"], "photo.png", { type: "image/png" })),
      }),
      Scene.expect(Scene.role("button", { name: "Uploading..." })).toExist(),
    );
  });

  test("waits for playback before offering chapter capture", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, mediaKey: "" }),
        editTitle: video.title,
        editDescription: video.description ?? "",
      }),
      Scene.expect(Scene.role("button", { name: "Add at playhead" })).not.toExist(),
    );
  });

  test("announces upload progress", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some({ ...video, mediaKey: "" }),
        editTitle: video.title,
        editDescription: video.description ?? "",
        isUploading: true,
        uploadingAssetId: Option.some(video.id),
        uploadStage: "transcoding",
        uploadPct: 42,
      }),
      Scene.expect(Scene.role("button", { name: "Uploading & Transcoding..." })).toExist(),
      Scene.expect(Scene.role("progressbar", { name: "Upload and transcode progress" })).toExist(),
      Scene.expect(Scene.text("42%", { exact: true })).toExist(),
    );
  });

  test("renders published video controls and pending changes", () => {
    const publishedAsset = {
      ...video,
      publishedAt: 1_750_000_002_000,
      updatedAt: 1_750_000_003_000,
    };

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(publishedAsset),
        editTitle: publishedAsset.title,
        editDescription: publishedAsset.description ?? "",
      }),
      Scene.expect(Scene.role("button", { name: "Republish" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Unpublish" })).toExist(),
      Scene.expect(Scene.text("Local changes are not live yet. Republish to update.")).toExist(),
    );
  });

  test("renders chapter validation", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
        editChapters: [{ ...chapter, title: "" }],
        chapterValidationError: Option.some("Every chapter needs a title before saving"),
      }),
      Scene.expect(Scene.role("alert")).toHaveText("Needs a title"),
      Scene.expect(Scene.text("Every chapter needs a title before saving")).toExist(),
      Scene.expect(Scene.label("Chapter title")).toExist(),
    );
  });

  test("renders editable chapter start times in playback order", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
        editChapters: [
          { ...chapter, title: "Intro", startSec: 0, sortOrder: 0 },
          { ...chapter, id: "chapter-2", title: "Shipping", startSec: 65, sortOrder: 1 },
        ],
      }),
      Scene.expect(Scene.label("Start time")).toExist(),
      Scene.expect(Scene.role("button", { name: "Remove chapter Intro" })).toExist(),
      Scene.expect(
        Scene.role("button", { name: "Set start time of Shipping to the playhead" }),
      ).toExist(),
    );
  });

  test("flags chapters that share a timestamp", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: EditAsset({ assetId: video.id }),
        editAsset: Option.some(video),
        editTitle: video.title,
        editDescription: video.description ?? "",
        editChapters: [
          { ...chapter, title: "Intro", startSec: 4, sortOrder: 0 },
          { ...chapter, id: "chapter-2", title: "Shipping", startSec: 4, sortOrder: 1 },
        ],
        chapterValidationError: Option.some(
          "Two chapters share a timestamp. Change one before saving.",
        ),
      }),
      Scene.expect(Scene.role("alert")).toHaveText("Another chapter already starts at 0:04"),
    );
  });

  test("renders destructive confirmation", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        confirmationDialog: Dialog.init({ id: "video-action-confirmation", isOpen: true }),
        pendingConfirmation: Option.some(DeleteAssetConfirmation({ assetId: video.id })),
      }),
      Scene.expect(Scene.role("dialog")).toExist(),
      Scene.expect(Scene.role("heading", { name: "Delete asset?" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Cancel" })).toExist(),
      Scene.expect(Scene.role("button", { name: "Delete" })).toExist(),
    );
  });

  test("renders the complete-catalog Republish warning for a dirty published project", () => {
    const detail = projectDetail({
      project: {
        ...projectDetail().project,
        publishedAt: 1_750_000_001_000,
        updatedAt: 1_750_000_002_000,
      },
    });

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectEdit({ projectId: detail.project.id }),
        editProject: Option.some(detail),
      }),
      Scene.expect(Scene.role("button", { name: "Republish" })).toExist(),
      Scene.expect(
        Scene.text(
          "This published project has local changes. Reorder, membership, metadata, and member changes remain local until you Republish the complete catalog.",
        ),
      ).toExist(),
    );
  });

  test("renders a copyable link only for published projects", () => {
    const published = projectDetail({
      project: { ...projectDetail().project, publishedAt: 1_750_000_001_000 },
    });

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectEdit({ projectId: published.project.id }),
        editProject: Option.some(published),
      }),
      Scene.expect(Scene.role("button", { name: "Copy project link" })).toExist(),
    );
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectEdit({ projectId: "project-1" }),
        editProject: Option.some(projectDetail()),
      }),
      Scene.expect(Scene.role("button", { name: "Copy project link" })).not.toExist(),
    );
  });

  test("renders pending project publication and disables conflicting controls", () => {
    const detail = projectDetail({
      project: { ...projectDetail().project, publishedAt: 1_750_000_001_000 },
    });

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectEdit({ projectId: detail.project.id }),
        editProject: Option.some(detail),
        projectOperation: ProjectOperationPending({ kind: "publish", id: detail.project.id }),
      }),
      Scene.expect(Scene.role("status")).toHaveText("Publishing project…"),
      Scene.expect(Scene.role("button", { name: "Move Project member down" })).toBeDisabled(),
      Scene.expect(Scene.role("button", { name: "Delete project" })).toBeDisabled(),
      Scene.expect(Scene.role("button", { name: "Publishing…" })).toBeDisabled(),
      Scene.expect(Scene.role("button", { name: "Unpublish" })).toBeDisabled(),
      Scene.expect(Scene.role("button", { name: "Copy project link" })).toBeDisabled(),
      Scene.expect(Scene.label("Title")).toBeDisabled(),
      Scene.expect(Scene.label("Description")).toBeDisabled(),
      Scene.expect(Scene.label("Password")).toBeDisabled(),
    );
  });

  test("disables metadata and project controls while metadata saves", () => {
    const detail = projectDetail();
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectEdit({ projectId: detail.project.id }),
        editProject: Option.some(detail),
        projectMetadataSaveInFlight: true,
      }),
      Scene.expect(Scene.label("Title")).toBeDisabled(),
      Scene.expect(Scene.label("Description")).toBeDisabled(),
      Scene.expect(Scene.label("Password")).toBeDisabled(),
      Scene.expect(Scene.role("button", { name: "Publish" })).toBeDisabled(),
      Scene.expect(Scene.role("button", { name: "Delete project" })).toBeDisabled(),
    );
  });

  test("does not render a stale project-operation retry", () => {
    const detail = projectDetail();
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectEdit({ projectId: detail.project.id }),
        editProject: Option.some(detail),
        projectOperation: ProjectOperationFailed({ kind: "delete", id: "another-project" }),
      }),
      Scene.expect(Scene.role("button", { name: "Retry delete" })).not.toExist(),
    );
  });

  test("disables a typed project-operation retry while membership is saving", () => {
    const detail = projectDetail();

    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        screen: ProjectEdit({ projectId: detail.project.id }),
        editProject: Option.some(detail),
        projectMembershipOperation: ProjectMembershipSaving(),
        projectOperation: ProjectOperationFailed({ kind: "publish", id: detail.project.id }),
      }),
      Scene.expect(Scene.role("button", { name: "Retry publish" })).toBeDisabled(),
    );
  });

  test("renders published project deletion preservation copy", () => {
    const detail = projectDetail({
      project: { ...projectDetail().project, publishedAt: 1_750_000_001_000 },
    });
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        confirmationDialog: Dialog.init({ id: "video-action-confirmation", isOpen: true }),
        pendingConfirmation: Option.some(DeleteProjectConfirmation({ projectId: "project-1" })),
        editProject: Option.some(detail),
      }),
      Scene.expect(
        Scene.text(
          "This removes the published project. Assets, media, and direct links remain; local assets become unfiled.",
          { exact: true },
        ),
      ).toExist(),
    );
  });

  test("renders draft project deletion preservation copy", () => {
    Scene.scene(
      { update, view },
      Scene.with({
        ...initialModel(),
        confirmationDialog: Dialog.init({ id: "video-action-confirmation", isOpen: true }),
        pendingConfirmation: Option.some(DeleteProjectConfirmation({ projectId: "project-1" })),
        editProject: Option.some(projectDetail()),
      }),
      Scene.expect(Scene.role("dialog")).toExist(),
      Scene.expect(Scene.role("heading", { name: "Delete project?" })).toExist(),
      Scene.expect(
        Scene.text(
          "This deletes the draft project. Assets, media, and direct links remain; local assets become unfiled.",
          { exact: true },
        ),
      ).toExist(),
      Scene.expect(Scene.role("button", { name: "Delete" })).toExist(),
    );
  });
});
