import { create } from "zustand";

type State = {
  selectedFieldId: number | null;
};
type Actions = {
  selectField: (id: number | null) => void;
};

export const useReportDesigner = create<State & Actions>((set) => ({
  selectedFieldId: null,
  selectField: (id) => set({ selectedFieldId: id }),
}));
