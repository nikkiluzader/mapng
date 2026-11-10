import { provide, inject, ref } from 'vue';

// Expand all / Collapse all for a panel's SettingSections. The panel calls
// provideSectionGroup(); every SettingSection inside it (nested components
// too) that is on screen follows setAll(open); SectionToggleAll is the two
// buttons (components/base/SectionToggleAll.vue), put at the top of each
// wizard step by WizardLayout.
const SECTION_GROUP = Symbol('mapngSectionGroup');

export function provideSectionGroup() {
  const signal = ref(null);   // { open, n }: n makes a repeat of the same command count
  const group = { signal, setAll: (open) => { signal.value = { open, n: (signal.value?.n || 0) + 1 }; } };
  provide(SECTION_GROUP, group);
  return group;
}

export const useSectionGroup = () => inject(SECTION_GROUP, null);
