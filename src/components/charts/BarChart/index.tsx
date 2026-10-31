'use client';
import dynamic from 'next/dynamic';
// import Chart from 'react-apexcharts';
const Chart = dynamic(() => import('react-apexcharts'), {
  ssr: false,
});

const BarChart = (props) => {
  const { chartData, chartOptions, height = '100%' } = props;

  return (
    // @ts-ignore
    <Chart
      options={chartOptions}
      type="bar"
      width="100%"
      height={height}
      series={chartData}
    />
  );
};

export default BarChart;
