import { ComponentType, Element } from 'react';

export interface IRoute {
  path: string;
  href?: string;
  name: string;
  layout?: string;
  exact?: boolean;
  component?: ComponentType;
  icon?: ComponentType | string | Element;
  secondary?: boolean;
  collapse?: boolean;
  hidden?: boolean;
  requiredPermission?: string;
  items?: IRoute[];
}
