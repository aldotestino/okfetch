import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import icon from '@/app/icon.svg';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Image src={icon} alt="" width={22} height={22} priority />
          <span className="font-mono font-semibold">{appName}</span>
        </>
      ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
