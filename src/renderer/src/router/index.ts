import { createRouter, createWebHashHistory } from 'vue-router'
import { createAuthClient } from '@api/AuthClient'

const authClient = createAuthClient()

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
      meta: {
        public: true,
        titleKey: 'routes.login'
      }
    },
    {
      path: '/',
      redirect: '/chat'
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('@/apps/chat-main/ChatTabView.vue'),
      meta: {
        titleKey: 'routes.chat',
        icon: 'lucide:message-square'
      }
    },
    {
      path: '/plugins',
      component: () => import('@/pages/plugins/PluginsHubPage.vue'),
      meta: {
        titleKey: 'routes.plugins',
        icon: 'lucide:puzzle'
      },
      children: [
        {
          path: '',
          name: 'plugins',
          component: () => import('@/pages/plugins/PluginsCatalogPage.vue'),
          meta: {
            titleKey: 'routes.plugins',
            icon: 'lucide:puzzle'
          }
        },
        {
          path: 'skills',
          name: 'plugins-skills',
          component: () => import('@/pages/plugins/SkillsPluginsPage.vue'),
          meta: {
            titleKey: 'routes.plugins-skills',
            icon: 'lucide:wand-sparkles'
          }
        },
        {
          path: 'mcp',
          name: 'plugins-mcp',
          component: () => import('@/pages/plugins/McpPluginsPage.vue'),
          meta: {
            titleKey: 'routes.settings-mcp',
            icon: 'lucide:server'
          }
        },
        {
          path: 'builtin/ocr',
          name: 'plugins-builtin-ocr',
          component: () => import('@/pages/plugins/OcrPluginsPage.vue'),
          meta: {
            titleKey: 'routes.settings-ocr',
            icon: 'lucide:scan-text'
          }
        },
        {
          path: 'remote',
          redirect: { name: 'plugins' }
        },
        {
          path: 'remote/:channel',
          redirect: (to) => ({
            name: 'plugins-detail',
            params: { pluginId: `remote:${String(to.params.channel)}` }
          })
        },
        {
          path: 'official/:pluginId',
          redirect: (to) => ({
            name: 'plugins-detail',
            params: { pluginId: String(to.params.pluginId) }
          })
        },
        {
          path: ':pluginId',
          name: 'plugins-detail',
          component: () => import('@/pages/plugins/OfficialPluginDetailPage.vue'),
          meta: {
            titleKey: 'routes.plugins',
            icon: 'lucide:puzzle'
          }
        }
      ]
    },
    {
      path: '/welcome',
      name: 'welcome',
      component: () => import('@/pages/WelcomePage.vue'),
      meta: {
        titleKey: 'routes.welcome',
        icon: 'lucide:message-square'
      }
    }
  ]
})

// 路由守卫：未登录时跳转到登录页
let authChecked = false
let isAuthenticated = false

router.beforeEach(async (to) => {
  // 公开页面（登录、注册）不需要认证
  if (to.meta.public) {
    return true
  }

  // 首次导航时检查认证状态
  if (!authChecked) {
    try {
      isAuthenticated = await authClient.getStatus()
    } catch {
      isAuthenticated = false
    }
    authChecked = true
  }

  if (!isAuthenticated && to.name !== 'login') {
    return { name: 'login' }
  }

  return true
})

export function clearAuthState() {
  authChecked = false
  isAuthenticated = false
}

export function setAuthState(authed: boolean) {
  authChecked = true
  isAuthenticated = authed
}

export default router
