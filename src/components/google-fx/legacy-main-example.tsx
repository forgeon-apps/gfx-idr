import React, { ReactNode } from 'react';

import { GoogleFxSearchMock } from '@/components/google-fx/GoogleFxSearchMock';

type IMainProps = {
  meta: ReactNode;
  children?: ReactNode;
};

// Drop-in replacement if you want your old Main layout to become this full-screen mock.
const Main = (props: IMainProps) => (
  <>
    {props.meta}
    <GoogleFxSearchMock />
  </>
);

export { Main };
