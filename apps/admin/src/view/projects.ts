import { Option } from "effect";
import { Button, Input, Textarea } from "@foldkit/ui";
import type { html } from "foldkit/html";
import type { Message } from "../message";
import {
  hasProjectUnpublishedChanges,
  VIEWER_BASE,
  type Asset,
  type Model,
  type Project,
} from "../model";
import {
  BlurredProjectField,
  ClickedAssets,
  ClickedAssignAssetToProject,
  ClickedDeleteProject,
  ClickedEditProject,
  ClickedMoveProjectMember,
  ClickedRetryLoadProjects,
  ClickedPublishProject,
  ClickedProjects,
  ClickedUnpublishProject,
  ClickedCopyLink,
  ClickedRetryProjectOperation,
  ClickedUnfileProjectMember,
  SubmittedCreateProject,
  UpdatedProjectDescription,
  UpdatedProjectPassword,
  UpdatedProjectTitle,
} from "../message";

type Html = ReturnType<typeof html<Message>>;

const panel = "rounded-xl border border-gray-800 bg-gray-900/50";
const control =
  "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

export const sectionNav = (h: Html, active: "assets" | "projects") =>
  h.nav(
    [h.AriaLabel("Admin sections"), h.Class("mb-8 flex gap-2")],
    [
      h.button(
        [
          h.Type("button"),
          h.OnClick(ClickedAssets()),
          h.Class(
            `rounded-lg px-3 py-2 text-sm font-medium ${active === "assets" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"}`,
          ),
        ],
        ["Assets"],
      ),
      h.button(
        [
          h.Type("button"),
          h.OnClick(ClickedProjects()),
          h.Class(
            `rounded-lg px-3 py-2 text-sm font-medium ${active === "projects" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`,
          ),
        ],
        ["Projects"],
      ),
    ],
  );

const errorNotice = (h: Html, model: Model) =>
  Option.isSome(model.errorMessage)
    ? [
        h.div(
          [
            h.Role("alert"),
            h.Class(
              "mb-4 rounded-lg border border-red-700 bg-red-900/50 px-4 py-3 text-sm text-red-200",
            ),
          ],
          [model.errorMessage.value],
        ),
      ]
    : [];

const projectRow = (h: Html, project: Project) =>
  h.li(
    [h.Class("flex items-center justify-between gap-4 px-4 py-3")],
    [
      h.div(
        [],
        [
          h.button(
            [
              h.Type("button"),
              h.OnClick(ClickedEditProject({ id: project.id })),
              h.Class("font-medium text-white hover:text-blue-300"),
            ],
            [project.title],
          ),
          h.p([h.Class("mt-1 text-xs text-gray-500")], [`${project.memberCount ?? 0} assets`]),
        ],
      ),
      h.span([h.Class("font-mono text-xs text-gray-500")], [project.slug]),
    ],
  );

export const projectListView = (h: Html, model: Model) =>
  h.div(
    [h.Class("mx-auto max-w-4xl")],
    [
      sectionNav(h, "projects"),
      h.div(
        [h.Class("mb-8 flex items-center justify-between gap-4")],
        [
          h.div(
            [],
            [
              h.h1([h.Class("text-2xl font-bold text-white")], ["Projects"]),
              h.p(
                [h.Class("mt-1 text-sm text-gray-400")],
                ["Group assets into an ordered client collection."],
              ),
            ],
          ),
          Button.view<Message>({
            onClick: SubmittedCreateProject(),
            toView: ({ button }) =>
              h.button(
                [
                  ...button,
                  h.Class(
                    "rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500",
                  ),
                ],
                ["New Project"],
              ),
          }),
        ],
      ),
      ...errorNotice(h, model),
      model.projectsLoadState._tag === "ProjectsLoading"
        ? h.div(
            [h.Class(`${panel} px-4 py-8 text-center text-sm text-gray-400`)],
            ["Loading projects…"],
          )
        : model.projectsLoadState._tag === "ProjectsFailed"
          ? h.div(
              [h.Class(`${panel} px-4 py-8 text-center text-sm text-red-200`)],
              [
                h.p([], ["Could not load projects."]),
                h.button(
                  [
                    h.Type("button"),
                    h.OnClick(ClickedRetryLoadProjects()),
                    h.Class("mt-3 font-medium text-blue-300 hover:text-blue-200"),
                  ],
                  ["Retry"],
                ),
              ],
            )
          : model.projects.length === 0
            ? h.div(
                [h.Class(`${panel} px-4 py-8 text-center text-sm text-gray-400`)],
                ["No projects yet. Create one to organize assets."],
              )
            : h.ul(
                [h.Class(`${panel} divide-y divide-gray-800`)],
                model.projects.map((project) => projectRow(h, project)),
              ),
    ],
  );

const metadata = (h: Html, model: Model, disabled: boolean) =>
  h.section(
    [h.Class(`${panel} p-5`)],
    [
      h.h2([h.Class("text-sm font-medium text-gray-200")], ["Metadata"]),
      h.div(
        [h.Class("mt-4 space-y-4")],
        [
          Input.view<Message>({
            id: "project-title",
            value: model.projectTitle,
            placeholder: "Project title",
            onInput: (title) => UpdatedProjectTitle({ title }),
            toView: ({ input, label }) =>
              h.div(
                [],
                [
                  h.label(
                    [...label, h.Class("block text-sm font-medium text-gray-300 mb-1")],
                    ["Title"],
                  ),
                  h.input([
                    ...input,
                    h.Disabled(disabled),
                    h.OnBlur(BlurredProjectField()),
                    h.Class(control),
                  ]),
                ],
              ),
          }),
          Textarea.view<Message>({
            id: "project-description",
            value: model.projectDescription,
            rows: 3,
            placeholder: "Project description",
            onInput: (description) => UpdatedProjectDescription({ description }),
            toView: ({ textarea, label }) =>
              h.div(
                [],
                [
                  h.label(
                    [...label, h.Class("block text-sm font-medium text-gray-300 mb-1")],
                    ["Description"],
                  ),
                  h.textarea(
                    [
                      ...textarea,
                      h.Disabled(disabled),
                      h.OnBlur(BlurredProjectField()),
                      h.Class(control),
                    ],
                    [],
                  ),
                ],
              ),
          }),
          h.div(
            [],
            [
              h.label(
                [
                  h.For("project-password"),
                  h.Class("block text-sm font-medium text-gray-300 mb-1"),
                ],
                ["Password"],
              ),
              h.input([
                h.Id("project-password"),
                h.Type("password"),
                h.Attribute("autocomplete", "new-password"),
                h.Value(Option.getOrElse(model.projectPassword, () => "")),
                h.OnInput((password) => UpdatedProjectPassword({ password })),
                h.Disabled(disabled),
                h.OnBlur(BlurredProjectField()),
                h.Class(control),
              ]),
              h.p(
                [h.Class("mt-1 text-xs text-gray-500")],
                [
                  "Leave untouched to keep the existing password. Clear a changed value to remove it.",
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );

const memberRow = (h: Html, asset: Asset, index: number, length: number, isSaving: boolean) =>
  h.li(
    [h.Class("flex items-center justify-between gap-3 px-4 py-3")],
    [
      h.span([h.Class("min-w-0 truncate text-sm text-gray-200")], [asset.title]),
      h.div(
        [h.Class("flex shrink-0 gap-1")],
        [
          h.button(
            [
              h.Type("button"),
              h.OnClick(ClickedMoveProjectMember({ assetId: asset.id, direction: "up" })),
              h.AriaLabel(`Move ${asset.title} up`),
              h.Disabled(isSaving || index === 0),
              h.Class(
                "rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40",
              ),
            ],
            ["↑"],
          ),
          h.button(
            [
              h.Type("button"),
              h.OnClick(ClickedMoveProjectMember({ assetId: asset.id, direction: "down" })),
              h.AriaLabel(`Move ${asset.title} down`),
              h.Disabled(isSaving || index === length - 1),
              h.Class(
                "rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40",
              ),
            ],
            ["↓"],
          ),
          h.button(
            [
              h.Type("button"),
              h.OnClick(ClickedUnfileProjectMember({ assetId: asset.id })),
              h.AriaLabel(`Unfile ${asset.title}`),
              h.Disabled(isSaving),
              h.Class("rounded px-2 py-1 text-xs text-amber-300 hover:bg-amber-900/30"),
            ],
            ["Unfile"],
          ),
        ],
      ),
    ],
  );

const unfiledAssets = (h: Html, model: Model, projectId: string, isSaving: boolean) => {
  const assets = model.assets.filter((asset) => asset.projectId === null);
  return h.section(
    [h.Class(panel)],
    [
      h.div(
        [h.Class("border-b border-gray-800 px-4 py-3")],
        [
          h.h2([h.Class("text-sm font-medium text-gray-200")], ["Unfiled assets"]),
          h.p(
            [h.Class("mt-1 text-xs text-gray-500")],
            ["Add an asset to append it to this project."],
          ),
        ],
      ),
      assets.length === 0
        ? h.p([h.Class("px-4 py-5 text-sm text-gray-500")], ["No unfiled assets."])
        : h.ul(
            [h.Class("divide-y divide-gray-800")],
            assets.map((asset) =>
              h.li(
                [h.Class("flex items-center justify-between gap-3 px-4 py-3")],
                [
                  h.span([h.Class("truncate text-sm text-gray-200")], [asset.title]),
                  h.button(
                    [
                      h.Type("button"),
                      h.OnClick(ClickedAssignAssetToProject({ assetId: asset.id, projectId })),
                      h.AriaLabel(`Add ${asset.title} to this project`),
                      h.Disabled(isSaving),
                      h.Class(
                        "rounded bg-gray-800 px-2 py-1 text-xs text-blue-300 hover:bg-gray-700",
                      ),
                    ],
                    ["Add"],
                  ),
                ],
              ),
            ),
          ),
    ],
  );
};

export const projectEditView = (h: Html, model: Model) => {
  const detail = Option.getOrUndefined(model.editProject);
  const members = detail?.assets ?? [];
  const isExisting = model.screen._tag === "ProjectEdit" && model.screen.projectId !== "new";
  const activeProjectOperation =
    model.projectOperation._tag !== "ProjectOperationIdle" &&
    model.projectOperation.id === detail?.project.id;
  const isProjectOperationPending =
    activeProjectOperation && model.projectOperation._tag === "ProjectOperationPending";
  const isSavingMembership =
    model.projectMetadataSaveInFlight ||
    model.projectMembershipOperation._tag === "ProjectMembershipSaving" ||
    isProjectOperationPending;
  const isDirty = detail ? hasProjectUnpublishedChanges(detail) : false;
  const operationLabel = isProjectOperationPending
    ? `${model.projectOperation.kind === "unpublish" ? "Unpublishing" : model.projectOperation.kind === "delete" ? "Deleting" : "Publishing"} project…`
    : null;
  const isPublishingProject =
    isProjectOperationPending && model.projectOperation.kind === "publish";
  const isUnpublishingProject =
    isProjectOperationPending && model.projectOperation.kind === "unpublish";
  return h.div(
    [h.Class("mx-auto max-w-4xl")],
    [
      sectionNav(h, "projects"),
      h.div(
        [h.Class("mb-8")],
        [
          h.h1(
            [h.Class("text-2xl font-bold text-white")],
            [detail?.project.title ?? "New Project"],
          ),
          h.p(
            [h.Class("mt-1 text-sm text-gray-400")],
            [
              detail
                ? "Changes save when a field loses focus."
                : "Enter a title, then leave a field to create this project.",
            ],
          ),
        ],
      ),
      ...errorNotice(h, model),
      isExisting && !detail
        ? h.div(
            [h.Class(`${panel} px-4 py-8 text-center text-sm text-gray-400`)],
            ["Loading project…"],
          )
        : h.div(
            [h.Class("space-y-6")],
            [
              metadata(h, model, isSavingMembership),
              ...(operationLabel
                ? [h.p([h.Role("status"), h.Class("text-sm text-blue-300")], [operationLabel])]
                : []),
              ...(activeProjectOperation && model.projectOperation._tag === "ProjectOperationFailed"
                ? [
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(ClickedRetryProjectOperation()),
                        h.Disabled(isSavingMembership || model.projectMetadataSaveInFlight),
                        h.Class(
                          "rounded-lg border border-red-700 px-3 py-2 text-sm text-red-200 disabled:opacity-40",
                        ),
                      ],
                      [`Retry ${model.projectOperation.kind}`],
                    ),
                  ]
                : []),
              ...(detail
                ? [
                    h.section(
                      [h.Class(panel)],
                      [
                        h.div(
                          [h.Class("border-b border-gray-800 px-4 py-3")],
                          [
                            h.h2(
                              [h.Class("text-sm font-medium text-gray-200")],
                              ["Ordered members"],
                            ),
                            h.p(
                              [h.Class("mt-1 text-xs text-gray-500")],
                              ["Use the arrows to set the viewing order."],
                            ),
                          ],
                        ),
                        members.length === 0
                          ? h.p(
                              [h.Class("px-4 py-5 text-sm text-gray-500")],
                              ["No assets in this project."],
                            )
                          : h.ul(
                              [h.Class("divide-y divide-gray-800")],
                              members.map((asset, index) =>
                                memberRow(h, asset, index, members.length, isSavingMembership),
                              ),
                            ),
                      ],
                    ),
                    unfiledAssets(h, model, detail.project.id, isSavingMembership),
                    h.section(
                      [h.Class(`${panel} p-5`)],
                      [
                        h.h2(
                          [h.Class("text-sm font-medium text-gray-200")],
                          ["Publish project catalog"],
                        ),
                        h.p(
                          [h.Class("mt-1 text-sm text-gray-400")],
                          [
                            detail.project.publishedAt !== null && isDirty
                              ? "This published project has local changes. Reorder, membership, metadata, and member changes remain local until you Republish the complete catalog."
                              : "Publishing synchronizes the complete published project catalog. Empty projects cannot be published.",
                          ],
                        ),
                        h.div(
                          [h.Class("mt-4 flex gap-2")],
                          [
                            h.button(
                              [
                                h.Type("button"),
                                h.OnClick(ClickedPublishProject({ id: detail.project.id })),
                                h.Disabled(
                                  model.isPublishing || isSavingMembership || members.length === 0,
                                ),
                                h.Class(
                                  "rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40",
                                ),
                              ],
                              [
                                isPublishingProject
                                  ? "Publishing…"
                                  : detail.project.publishedAt === null
                                    ? "Publish"
                                    : "Republish",
                              ],
                            ),
                            ...(detail.project.publishedAt !== null
                              ? [
                                  h.button(
                                    [
                                      h.Type("button"),
                                      h.OnClick(ClickedUnpublishProject({ id: detail.project.id })),
                                      h.Disabled(model.isPublishing || isSavingMembership),
                                      h.Class(
                                        "rounded-lg border border-amber-700 px-3 py-2 text-sm text-amber-200 disabled:opacity-40",
                                      ),
                                    ],
                                    [isUnpublishingProject ? "Unpublishing…" : "Unpublish"],
                                  ),
                                ]
                              : []),
                            ...(detail.project.publishedAt !== null
                              ? [
                                  h.button(
                                    [
                                      h.Type("button"),
                                      h.OnClick(
                                        ClickedCopyLink({
                                          url: `${VIEWER_BASE}/p/${encodeURIComponent(detail.project.slug)}`,
                                        }),
                                      ),
                                      h.Disabled(model.isPublishing || isSavingMembership),
                                      h.Class(
                                        "rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 disabled:opacity-40",
                                      ),
                                    ],
                                    [model.copiedLink ? "Copied" : "Copy project link"],
                                  ),
                                ]
                              : []),
                          ],
                        ),
                      ],
                    ),
                    h.section(
                      [h.Class("rounded-xl border border-red-900/70 bg-red-950/20 p-5")],
                      [
                        h.h2([h.Class("text-sm font-medium text-red-200")], ["Danger zone"]),
                        h.p(
                          [h.Class("mt-1 text-sm text-red-200/70")],
                          [
                            "Deleting this project removes its publication, leaves assets as direct rows, and unfiles them locally.",
                          ],
                        ),
                        h.button(
                          [
                            h.Type("button"),
                            h.OnClick(ClickedDeleteProject({ id: detail.project.id })),
                            h.Disabled(isSavingMembership || isProjectOperationPending),
                            h.Class(
                              "mt-4 rounded-lg border border-red-700 px-3 py-2 text-sm font-medium text-red-300 hover:bg-red-900/40",
                            ),
                          ],
                          ["Delete project"],
                        ),
                      ],
                    ),
                  ]
                : []),
            ],
          ),
    ],
  );
};
