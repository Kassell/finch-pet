import type * as finch from 'finch';

/** 工具箱优先提供添加/显示入口，运行反馈设置置后。 */
export function createPetSettingsMenu(input: {
  petAvailable: boolean;
  visible: boolean;
  t: (key: string) => string;
  runtimeFeedbackItem: finch.ComposerActionMenuItem;
}): finch.ComposerActionMenuItem[] {
  const { petAvailable, visible, t, runtimeFeedbackItem } = input;
  return [
    {
      id: 'install:catalog',
      label: t(petAvailable ? 'composerActions.pet-toggle.addPet' : 'settingsMenu.addFirstPet'),
      iconName: 'ext:finch-pet/add',
    },
    ...(petAvailable ? [{
      id: visible ? 'visibility:hide' : 'visibility:show',
      label: t(`composerActions.pet-toggle.${visible ? 'hidePet' : 'showPet'}`),
      iconName: visible ? 'ext:finch-pet/eye-off' : 'ext:finch-pet/eye',
    }] : []),
    { id: 'separator:runtime', label: '', separator: true },
    runtimeFeedbackItem,
  ];
}
