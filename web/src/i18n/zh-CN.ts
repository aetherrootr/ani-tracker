export const zhCN = {
  app: {
    language: "语言",
    languageChinese: "简体中文",
    languageEnglish: "English",
    currentUser: "当前用户",
    loadingAccount: "正在加载账号状态...",
    toggleTheme: "切换主题",
    logout: "注销",
    loggingOut: "注销中",
  },
  nav: {
    trackingList: "Tracking List",
    search: "搜索",
    settings: "设置",
  },
  auth: {
    login: {
      title: "登录",
      description: "使用用户名和密码进入你的 Ani Tracker。",
      submit: "登录",
      submitting: "登录中...",
      missingCredentials: "请输入用户名和密码。",
      fallbackError: "登录失败，请稍后重试。",
      noAccount: "还没有账号？",
    },
    register: {
      title: "创建账号",
      description: "注册后即可进入追番列表，后续功能会继续接入。",
      submit: "创建账号",
      submitting: "创建中...",
      hasAccount: "已有账号？",
      usernameTooShort: "用户名至少需要 3 个字符。",
      invalidEmail: "请输入有效的邮箱地址。",
      passwordTooShort: "密码至少需要 8 个字符。",
      displayNameTooLong: "展示名不能超过 100 个字符。",
      fallbackError: "注册失败，请稍后重试。",
    },
  },
  form: {
    username: "用户名",
    email: "邮箱",
    password: "密码",
    displayNameOptional: "展示名（可选）",
  },
  tracking: {
    eyebrow: "Tracking List",
    title: "Tracking List",
    description: "记录正在追、想看和已完成的动画。这里先保留页面入口，具体列表能力后续独立设计。",
    placeholder: "Tracking List 内容区域待实现。",
  },
  settings: {
    title: "设置",
    description: "预留页面，后续可加入同步源、主题和账号设置。",
    language: {
      title: "语言",
      description: "选择前端界面语言。",
    },
    backend: {
      title: "后端接入",
      description: "当前前端不接真实服务。后续接入方式会在相关页面和数据结构确定后再设计。",
    },
  },
  search: {
    title: "搜索动画",
    cardTitle: "搜索",
    placeholder: "搜索动画，例如 孤独摇滚",
    retry: "重试",
    provider: "Provider",
    chooseProvider: "选择 Provider",
    closeProviderSettings: "关闭 provider 设置",
    currentProvider: "当前使用",
    loadingMore: "加载更多中...",
    retryLoad: "重试加载",
    allLoaded: "已加载全部结果",
    backToTop: "回到页面开头",
    emptyPrompt: "输入动画名称开始搜索",
    loading: "搜索中...",
    noResults: "没有找到相关动画",
    resultSummary: "共找到 {total} 个结果，当前显示 {resultCount} 个",
    failed: "搜索失败，请稍后重试",
    loadMoreFailed: "加载更多失败，请稍后重试",
  },
  anime: {
    coverAlt: "{title} 封面",
    noCover: "无封面",
    originalTitle: "原名：{title}",
    expandDetails: "展开详情",
    collapseDetails: "收起详情",
    episodeCount: "{count} 集",
    externalId: "外部 ID",
    platform: "剧集类型",
    episodes: "集数",
    airDate: "开播时间",
    noSummary: "暂无简介",
    viewOnProvider: "在 {provider} 查看",
    unknown: "未知",
  },
} as const;

type DotPrefix<TPrefix extends string, TKey extends string> = TPrefix extends ""
  ? TKey
  : `${TPrefix}.${TKey}`;

type NestedKeys<TMessages, TPrefix extends string = ""> = {
  [TKey in keyof TMessages & string]: TMessages[TKey] extends string
    ? DotPrefix<TPrefix, TKey>
    : NestedKeys<TMessages[TKey], DotPrefix<TPrefix, TKey>>;
}[keyof TMessages & string];

export type TranslationKey = NestedKeys<typeof zhCN>;
export type TranslationMessages<TMessages> = {
  [TKey in keyof TMessages]: TMessages[TKey] extends string
    ? string
    : TranslationMessages<TMessages[TKey]>;
};
