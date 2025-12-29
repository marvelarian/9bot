'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  TrendingUp,
  BarChart3,
  Activity,
  FileText,
  Grid,
  Shield,
  Target,
  KeyRound,
  SlidersHorizontal,
  LogOut,
  AlertTriangle
} from 'lucide-react';
import { AlertSystem } from '@/lib/alert-system';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const menuItems = [
  {
    title: 'Home',
    items: [
      { name: 'Portfolio', href: '/portfolio', icon: BarChart3 },
      { name: 'Performance Metrics', href: '/performance', icon: TrendingUp },
      { name: 'Open Position', href: '/positions', icon: Activity },
      { name: 'Recent Order', href: '/orders', icon: FileText },
      { name: 'Grid Status', href: '/grid-status', icon: Grid },
    ]
  },
  {
    title: 'Create Bot',
    items: [
      { name: 'Input Parameters', href: '/bot/create', icon: SlidersHorizontal },
      { name: 'Circuit Breaker', href: '/bot/circuit-breaker', icon: Shield },
      { name: 'Range Detection', href: '/bot/range', icon: Target },
    ]
  },
  {
    title: 'API Integration',
    items: [
      { name: 'API Integration', href: '/api-integration', icon: KeyRound },
    ]
  }
];

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [isLoggedIn, setIsLoggedIn] = useState(true); // This should come from auth context
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [alertSystem] = useState(() => new AlertSystem());

  useEffect(() => {
    const unsubscribe = alertSystem.subscribe(() => {
      setUnreadAlerts(alertSystem.getUnreadCount());
    });

    return unsubscribe;
  }, [alertSystem]);

  if (!isLoggedIn) {
    return (
      <div className="w-64 bg-gray-800 text-white">
        <div className="p-4">
          <h2 className="text-xl font-bold">API Validation Failed</h2>
          <p className="text-sm text-gray-300 mt-2">Please check your API credentials</p>
          <button className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">
            Logout
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${isOpen ? 'w-72' : 'w-16'} bg-slate-950 text-white transition-all duration-300 border-r border-white/10`}>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-3 ${!isOpen && 'hidden'}`}>
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600" />
            <div className="leading-tight">
              <div className="font-bold text-sm">9BOT</div>
              <div className="text-[11px] text-slate-300">Grid Trading</div>
            </div>
          </div>
          <button onClick={onToggle} className="p-1 rounded hover:bg-gray-700">
            {/* Menu icon - could use lucide-react Menu icon */}
            <div className="w-6 h-6 flex flex-col justify-center">
              <div className="w-5 h-0.5 bg-white mb-1"></div>
              <div className="w-5 h-0.5 bg-white mb-1"></div>
              <div className="w-5 h-0.5 bg-white"></div>
            </div>
          </button>
        </div>

        {/* Alerts indicator */}
        {isOpen && unreadAlerts > 0 && (
          <div className="mt-4 p-3 bg-yellow-500/15 border border-yellow-400/20 rounded-lg flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2" />
            <span className="text-sm text-yellow-200">{unreadAlerts} unread alerts</span>
          </div>
        )}
      </div>

      <nav className="mt-8">
        {menuItems.map((section) => (
          <div key={section.title} className="mb-8">
            {isOpen && (
              <h3 className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {section.title}
              </h3>
            )}
            <ul>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      className={`flex items-center px-4 py-3 text-sm font-medium rounded-xl mx-2 mb-1 transition-colors ${
                        isActive
                          ? 'bg-white/10 text-white border border-white/10'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <Icon className="w-5 h-5 mr-3" />
                      {isOpen && <span>{item.name}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="absolute bottom-4 left-4 right-4">
        <button className="flex items-center w-full px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 rounded-lg">
          <LogOut className="w-5 h-5 mr-3" />
          {isOpen && <span>Logout</span>}
        </button>
      </div>
    </div>
  );
}

