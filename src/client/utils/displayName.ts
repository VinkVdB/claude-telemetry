export function sessionDisplayName(session: { custom_slug?: string | null; title?: string | null; slug?: string | null; id: string }): string {
  return session.custom_slug ?? session.title ?? session.slug ?? session.id.slice(0, 8);
}

export function projectDisplayName(project: { name: string }): string {
  return project.name;
}
