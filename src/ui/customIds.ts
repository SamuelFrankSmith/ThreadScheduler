/**
 * Custom ID scheme for component and modal interactions. Every ID is
 * `<namespace>:<action>[:<arg>...]` and stays well under Discord's 100-char limit.
 */

export const EDIT_FIELDS = ['title', 'message', 'channel', 'datetime', 'interval'] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

export const ids = {
  list: {
    page: (page: number) => `lt:page:${page}`,
    select: (page: number) => `lt:select:${page}`,
    detail: (id: number) => `lt:detail:${id}`,
    edit: (id: number) => `lt:edit:${id}`,
    delete: (id: number) => `lt:delete:${id}`,
    deleteConfirm: (id: number) => `lt:delconfirm:${id}`,
    field: (field: EditField, id: number) => `lt:field:${field}:${id}`,
    modal: (field: EditField, id: number) => `lt:modal:${field}:${id}`,
    save: (id: number) => `lt:save:${id}`,
    back: (id?: number) => (id === undefined ? 'lt:back' : `lt:back:${id}`),
  },
  subscribe: { select: () => 'sub:select' },
  unsubscribe: { select: () => 'unsub:select' },
  /** The single input inside every edit modal. */
  modalInput: 'value',
};

export function parseCustomId(customId: string): { namespace: string; action: string; args: string[] } {
  const [namespace = '', action = '', ...args] = customId.split(':');
  return { namespace, action, args };
}

export function isEditField(value: string | undefined): value is EditField {
  return (EDIT_FIELDS as readonly string[]).includes(value ?? '');
}
