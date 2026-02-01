import { ComponentType, Element } from 'react';

export interface IRoute {
  path: string;
  name: string;
  layout?: string;
  exact?: boolean;
  component?: ComponentType;
  icon?: ComponentType | string | Element;
  secondary?: boolean;
  collapse?: boolean;
  items?: RoutesType[];
  /** Kto widzi tę pozycję (np. [1] = tylko Super Admin) */
  roles?: number[];
  hidden?: boolean;
}
