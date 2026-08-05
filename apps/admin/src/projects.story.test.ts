import { Option } from "effect";
import { Story } from "foldkit";
import { expect, test } from "vitest";
import { LoadAssets, LoadProjects, MoveProjectMember, SaveProject } from "./commands";
import {
  BlurredProjectField,
  ClickedAssignAssetToProject,
  ClickedMoveProjectMember,
  ClickedProjects,
  ClickedRetryLoadProjects,
  ClickedUnfileProjectMember,
  SubmittedCreateProject,
  SucceededDeleteProject,
  SucceededLoadAssets,
  SucceededLoadProjects,
  SucceededLoadProject,
  FailedLoadProject,
  FailedLoadProjects,
  SucceededSaveProject,
  ClickedEditProject,
  UpdatedProjectPassword,
  UpdatedProjectTitle,
  ClickedPublishProject,
  SucceededPublishProject,
  FailedPublishProject,
  ClickedUnpublishProject,
  SucceededUnpublishProject,
  FailedUnpublishProject,
  ClickedCopyLink,
  CopiedLink,
} from "./message";
import {
  EditAsset,
  initialModel,
  ProjectEdit,
  ProjectList,
  type Asset,
  type ProjectDetail,
} from "./model";
import { update } from "./update";

const asset = (id: string, projectId: string | null, sortOrder: number | null): Asset => ({
  id,
  slug: `asset-${id}`,
  kind: "video",
  title: `Asset ${id}`,
  description: null,
  posterKey: null,
  mediaKey: "",
  durationSec: 0,
  width: null,
  height: null,
  projectId,
  sortOrder,
  createdAt: 1,
  publishedAt: null,
  updatedAt: null,
});

const detail = (assets: ReadonlyArray<Asset> = []): ProjectDetail => ({
  project: {
    id: "project-1",
    slug: "project-1",
    title: "Project one",
    description: null,
    createdAt: 1,
    publishedAt: null,
    updatedAt: null,
  },
  assets,
});

test("navigates to projects and loads the project summaries", () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(ClickedProjects()),
    Story.Command.expectExact(LoadProjects()),
    Story.Command.resolve(
      LoadProjects,
      SucceededLoadProjects({ projects: [{ ...detail().project, memberCount: 2 }] }),
    ),
    Story.model((model) => {
      expect(model.screen).toEqual(ProjectList());
      expect(model.projectsLoadState._tag).toBe("ProjectsLoaded");
      expect(model.projects[0]?.memberCount).toBe(2);
    }),
  );
});

test("creates a project then uses the server-confirmed edit screen", () => {
  Story.story(
    update,
    Story.with(initialModel()),
    Story.message(SubmittedCreateProject()),
    Story.message(UpdatedProjectTitle({ title: "Client work" })),
    Story.message(BlurredProjectField()),
    Story.Command.expectExact(
      SaveProject({
        id: undefined,
        title: "Client work",
        description: "",
        password: Option.none(),
      }),
    ),
    Story.Command.resolve(SaveProject, SucceededSaveProject({ detail: detail() })),
    Story.Command.resolve(LoadProjects, SucceededLoadProjects({ projects: [] })),
    Story.Command.resolve(LoadAssets, SucceededLoadAssets({ assets: [] })),
    Story.model((model) => {
      expect(model.screen).toEqual(ProjectEdit({ projectId: "project-1" }));
      expect(model.editProject).toEqual(Option.some(detail()));
    }),
  );
});

test("sends ordered moves, unfiles, and assigns assets through project commands", () => {
  const members = [asset("a", "project-1", 0), asset("b", "project-1", 1)];
  const model = {
    ...initialModel(),
    screen: ProjectEdit({ projectId: "project-1" }),
    assets: [...members, asset("free", null, null)],
    editProject: Option.some(detail(members)),
  };

  const [, reorder] = update(model, ClickedMoveProjectMember({ assetId: "b", direction: "up" }));
  const [, unfile] = update(model, ClickedUnfileProjectMember({ assetId: "a" }));
  const [, assign] = update(
    model,
    ClickedAssignAssetToProject({ assetId: "free", projectId: "project-1" }),
  );

  expect(reorder[0]).toMatchObject({
    name: MoveProjectMember.name,
    args: { projectId: "project-1", assetId: "b", position: 0, unfile: false },
  });
  expect(unfile[0]).toMatchObject({
    name: MoveProjectMember.name,
    args: { projectId: "project-1", assetId: "a", unfile: true },
  });
  expect(assign[0]).toMatchObject({
    name: MoveProjectMember.name,
    args: { projectId: "project-1", assetId: "free", unfile: false },
  });
});

test("preserves an untouched password and represents an explicit clear", () => {
  const model = {
    ...initialModel(),
    screen: ProjectEdit({ projectId: "project-1" }),
    editProject: Option.some(detail()),
    projectTitle: "Project one",
  };
  const [, untouched] = update(model, BlurredProjectField());
  const [cleared] = update(model, UpdatedProjectPassword({ password: "" }));
  const [, explicitClear] = update(cleared, BlurredProjectField());

  expect(untouched).toEqual([]);
  expect(explicitClear[0]).toMatchObject({
    name: SaveProject.name,
    args: { id: "project-1", title: "Project one", description: "", password: Option.some("") },
  });
});

test("rejects a late project detail for a route that is no longer active", () => {
  const [opened] = update(initialModel(), ClickedEditProject({ id: "project-2" }));
  const [next, commands] = update(opened, SucceededLoadProject({ detail: detail() }));

  expect(next).toEqual(opened);
  expect(commands).toEqual([]);
});

test("unfiles from the authoritative active asset detail rather than its stale list entry", () => {
  const active = asset("member", "project-1", 0);
  const model = {
    ...initialModel(),
    screen: EditAsset({ assetId: active.id }),
    assets: [asset(active.id, null, null)],
    editAsset: Option.some(active),
  };

  const [, commands] = update(
    model,
    ClickedAssignAssetToProject({ assetId: active.id, projectId: "" }),
  );

  expect(commands[0]).toMatchObject({
    name: MoveProjectMember.name,
    args: { projectId: "project-1", assetId: active.id, unfile: true },
  });
});

test("keeps stale project load failures off a different active editor", () => {
  const [opened] = update(initialModel(), ClickedEditProject({ id: "project-2" }));
  const [next, commands] = update(
    opened,
    FailedLoadProject({ id: "project-1", error: "not found" }),
  );

  expect(next).toEqual(opened);
  expect(commands).toEqual([]);
});

test("models project list failures and retries instead of treating them as loaded", () => {
  const [failed] = update(initialModel(), FailedLoadProjects({ error: "offline" }));
  const [retrying, commands] = update(failed, ClickedRetryLoadProjects());

  expect(failed.projectsLoadState._tag).toBe("ProjectsFailed");
  expect(retrying.projectsLoadState._tag).toBe("ProjectsLoading");
  expect(commands).toEqual([LoadProjects()]);
});

test("serializes membership commands and applies server-confirmed assignment to an active asset", () => {
  const editing = {
    ...initialModel(),
    screen: EditAsset({ assetId: "free" }),
    assets: [asset("free", null, null)],
    editAsset: Option.some(asset("free", null, null)),
  };
  const [saving, commands] = update(
    editing,
    ClickedAssignAssetToProject({ assetId: "free", projectId: "project-1" }),
  );
  const [, ignored] = update(
    saving,
    ClickedAssignAssetToProject({ assetId: "free", projectId: "project-1" }),
  );
  const [confirmed] = update(
    saving,
    SucceededSaveProject({ detail: detail([asset("free", "project-1", 0)]) }),
  );

  expect(saving.projectMembershipOperation._tag).toBe("ProjectMembershipSaving");
  expect(commands).toHaveLength(1);
  expect(ignored).toEqual([]);
  expect(confirmed.projectMembershipOperation._tag).toBe("ProjectMembershipIdle");
  expect(Option.getOrThrow(confirmed.editAsset)).toMatchObject({
    projectId: "project-1",
    sortOrder: 0,
  });
});

test("publishing projects records Foldkit success, failure, and share-link state", () => {
  const model = {
    ...initialModel(),
    screen: ProjectEdit({ projectId: "project-1" }),
    projects: [{ ...detail().project, memberCount: 1 }],
    editProject: Option.some(detail()),
  };
  const [publishing, commands] = update(model, ClickedPublishProject({ id: "project-1" }));
  const [published] = update(publishing, SucceededPublishProject({ id: "project-1" }));
  const [failed] = update(publishing, FailedPublishProject({ error: "remote unavailable" }));
  const [copying, copyCommands] = update(
    model,
    ClickedCopyLink({ url: "https://example.test/p/project-1" }),
  );
  const [copied] = update(copying, CopiedLink());

  expect(publishing.isPublishing).toBe(true);
  expect(commands).toHaveLength(1);
  expect(published.isPublishing).toBe(false);
  expect(published.projects[0]?.publishedAt).not.toBeNull();
  expect(failed.errorMessage).toEqual(Option.some("remote unavailable"));
  expect(copyCommands).toHaveLength(1);
  expect(copied.copiedLink).toBe(true);
});

test("unpublishing a project removes only its project publication state", () => {
  const published = {
    ...detail(),
    project: { ...detail().project, publishedAt: 10 },
    assets: [{ ...asset("protected-member", "project-1", 0), publishedAt: 9 }],
  };
  const model = {
    ...initialModel(),
    screen: ProjectEdit({ projectId: "project-1" }),
    projects: [{ ...published.project, memberCount: 1 }],
    assets: [...published.assets],
    editProject: Option.some(published),
  };
  const [unpublishing, commands] = update(model, ClickedUnpublishProject({ id: "project-1" }));
  const [unpublished] = update(unpublishing, SucceededUnpublishProject({ id: "project-1" }));
  const [failed] = update(unpublishing, FailedUnpublishProject({ error: "remote unavailable" }));

  expect(unpublishing.isPublishing).toBe(true);
  expect(commands).toHaveLength(1);
  expect(unpublished.projects[0]?.publishedAt).toBeNull();
  expect(Option.getOrThrow(unpublished.editProject).assets[0]).toMatchObject({
    projectId: "project-1",
    publishedAt: 9,
  });
  expect(failed.errorMessage).toEqual(Option.some("remote unavailable"));
});

test("delete responses unfile model assets", () => {
  const model = {
    ...initialModel(),
    screen: ProjectEdit({ projectId: "project-1" }),
    projects: [{ ...detail().project, memberCount: 1 }],
    assets: [asset("a", "project-1", 0)],
  };
  const [next] = update(model, SucceededDeleteProject({ id: "project-1" }));

  expect(next.screen).toEqual(ProjectList());
  expect(next.assets[0]).toMatchObject({ projectId: null, sortOrder: null });
  expect(next.projects).toEqual([]);
});
