import { redirect } from "next/navigation";

/** Tasks are added and worked on from Today now; old links land there. */
export default function TasksPage() {
  redirect("/today");
}
