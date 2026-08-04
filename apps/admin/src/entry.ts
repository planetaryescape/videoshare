import { Runtime } from "foldkit";
import { mountChapterPlayer } from "./chapterPlayer";
import { mountChapterReorder } from "./chapterReorder";
import { Message, Model, init, subscriptions, update, view } from "./main";

const program = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById("root"),
  devTools: { Message },
});

Runtime.run(program);
mountChapterPlayer();
mountChapterReorder();
